package com.acme.staticforge.housekeeping.variants;

import com.acme.staticforge.asset.AssetVersion;
import com.acme.staticforge.asset.media.BlobStore;
import com.acme.staticforge.asset.media.MediaFiles;
import com.acme.staticforge.asset.media.MediaVariantGenerator;
import com.acme.staticforge.asset.media.MediaVariantRepository;
import com.acme.staticforge.asset.media.MediaVariantResolver;
import com.acme.staticforge.asset.media.MediaVariantSpec;
import com.acme.staticforge.asset.media.MediaVersionRepository;
import com.acme.staticforge.housekeeping.HousekeepingJob;
import com.acme.staticforge.housekeeping.JobContext;
import com.acme.staticforge.housekeeping.JobDefaults;
import com.acme.staticforge.housekeeping.JobResult;
import com.acme.staticforge.housekeeping.SettingsSpec;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.awt.image.BufferedImage;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Component;

/**
 * Job {@code media-variant-backfill} (M29.3.2, epic decision 10): creates the variants of the current policy
 * ({@code sf.media.variants}) that media files are missing — a definition added after the upload, or an encode that
 * failed then. For every open media version (closed ones too with {@code includeHistorical}) and each of its files
 * (the top-level file and every per-locale file, M27.3.1) whose MIME type is a raster image, each definition that
 * neither the payload nor {@code media_variant} has is encoded, stored and recorded in {@code media_variant} only.
 *
 * <p>No revision is written and no payload changed, so a backfill never creates a draft or touches content history;
 * readers see the new variants through {@link MediaVariantResolver}. Each variant is one short transaction; at most
 * {@code maxPerRun} are attempted per run. A failure (unreadable or undecodable source, encoder error) is counted per
 * MIME type, definition and reason and tried again on the next run; the run is then {@code PARTIAL}. A definition this
 * JVM can't encode ({@code webp}) is reported once under {@code unsupported}, not per file.
 */
@Component
public class MediaVariantBackfillJob implements HousekeepingJob {

    public static final String KEY = "media-variant-backfill";

    static final int PAGE = 200;

    static final SettingsSpec SETTINGS = SettingsSpec.builder()
            .integer("maxPerRun", 1, 100_000)
            .bool("includeHistorical")
            .build();

    private final MediaVariantBackfillProperties properties;
    private final MediaVersionRepository mediaVersions;
    private final MediaVariantResolver resolver;
    private final MediaVariantGenerator generator;
    private final BlobStore blobStore;

    public MediaVariantBackfillJob(
            MediaVariantBackfillProperties properties,
            MediaVersionRepository mediaVersions,
            MediaVariantResolver resolver,
            MediaVariantGenerator generator,
            BlobStore blobStore) {
        this.properties = properties;
        this.mediaVersions = mediaVersions;
        this.resolver = resolver;
        this.generator = generator;
        this.blobStore = blobStore;
    }

    @Override
    public String key() {
        return KEY;
    }

    @Override
    public String displayName() {
        return "Media variant backfill";
    }

    @Override
    public String description() {
        return "Creates missing or failed image variants of the current variant policy, without a new revision.";
    }

    @Override
    public JobDefaults defaults() {
        return JobDefaults.of(properties, settings -> settings
                .put("maxPerRun", properties.getMaxPerRun())
                .put("includeHistorical", properties.isIncludeHistorical()));
    }

    @Override
    public List<String> validateSettings(JsonNode settings) {
        return SETTINGS.validate(settings);
    }

    /** One raster file of a media version: its source blob, MIME type and the variant names its payload has. */
    private record SourceFile(String sha, String mimeType, Set<String> payloadNames) {}

    /** A variant this run already created or tried (per source blob and definition). */
    private record Attempt(String sha, MediaVariantSpec spec) {}

    @Override
    public JobResult run(JobContext ctx) {
        int maxPerRun = ctx.settings().intValue("maxPerRun");
        boolean includeHistorical = ctx.settings().bool("includeHistorical");
        List<MediaVariantSpec> encodable = new ArrayList<>();
        ArrayNode unsupported = ctx.report().putArray("unsupported");
        for (MediaVariantSpec spec : resolver.policy()) {
            if (spec.supported()) {
                encodable.add(spec);
            } else {
                unsupported.add(spec.label() + " (unsupported format)");
            }
        }
        Map<String, Long> failures = new LinkedHashMap<>();
        Set<Attempt> attempted = new HashSet<>();
        long created = 0;
        int attempts = 0;
        boolean limitReached = false;
        long afterId = 0;

        while (!encodable.isEmpty() && !limitReached) {
            ctx.checkCancelled();
            long after = afterId;
            List<AssetVersion> page = ctx.inTransaction(
                    () -> mediaVersions.findMediaAfter(after, includeHistorical, PageRequest.of(0, PAGE)));
            if (page.isEmpty()) {
                break;
            }
            afterId = page.get(page.size() - 1).getId();
            List<SourceFile> files = new ArrayList<>();
            page.forEach(version -> files.addAll(rasterFiles(version.getPayload())));
            ctx.examined(files.size());
            Set<String> shas = new LinkedHashSet<>();
            files.forEach(file -> shas.add(file.sha()));
            Map<String, List<MediaVariantRepository.Row>> rows = resolver.rowsFor(shas);

            for (SourceFile file : files) {
                List<MediaVariantSpec> missing = new ArrayList<>();
                for (MediaVariantSpec spec : encodable) {
                    boolean present = file.payloadNames().contains(spec.name())
                            || rows.getOrDefault(file.sha(), List.of()).stream().anyMatch(r -> r.spec().equals(spec));
                    if (!present && attempted.add(new Attempt(file.sha(), spec))) {
                        missing.add(spec);
                    }
                }
                if (missing.isEmpty()) {
                    continue;
                }
                if (attempts + missing.size() > maxPerRun) {
                    missing = missing.subList(0, Math.max(0, maxPerRun - attempts));
                    limitReached = true;
                }
                attempts += missing.size();
                if (!missing.isEmpty()) {
                    created += backfill(ctx, file, missing, failures);
                }
                if (limitReached) {
                    break;
                }
            }
            ctx.progress("Created " + created + " variants, " + attempts + " of at most " + maxPerRun + " attempts");
        }

        ObjectNode report = ctx.report();
        report.put("created", created);
        report.put("limitReached", limitReached);
        ArrayNode failed = report.putArray("failures");
        failures.forEach((key, count) -> {
            String[] parts = key.split("\\|", 3);
            failed.addObject().put("mimeType", parts[0]).put("definition", parts[1]).put("reason", parts[2])
                    .put("count", count);
        });
        long failedCount = failures.values().stream().mapToLong(Long::longValue).sum();
        String message = "Created " + created + " variants"
                + (failedCount > 0 ? ", " + failedCount + " failed (retried next run)" : "")
                + (unsupported.isEmpty() ? "" : ", " + unsupported.size() + " unsupported definitions")
                + (limitReached ? "; the per-run limit was reached" : "") + ".";
        return failedCount > 0 ? JobResult.partial(message) : JobResult.succeeded(message);
    }

    /** Creates {@code missing} variants of {@code file}; the number created. Failures go to {@code failures}. */
    private long backfill(JobContext ctx, SourceFile file, List<MediaVariantSpec> missing, Map<String, Long> failures) {
        BufferedImage image;
        try {
            image = MediaVariantGenerator.decode(blobStore.get(file.sha()), file.mimeType());
        } catch (RuntimeException e) {
            missing.forEach(spec -> fail(failures, file, spec, "source unreadable"));
            return 0;
        }
        if (image == null) {
            missing.forEach(spec -> fail(failures, file, spec, "source could not be decoded"));
            return 0;
        }
        long created = 0;
        for (MediaVariantSpec spec : missing) {
            ctx.checkCancelled();
            String error;
            try {
                error = ctx.inTransaction(() -> {
                    try {
                        ObjectNode entry = generator.generate(file.sha(), image, spec);
                        ctx.sample(entry.put("source", file.sha()));
                        return null;
                    } catch (MediaVariantGenerator.EncodingException e) {
                        return "encode failed: " + e.getMessage();
                    }
                });
            } catch (RuntimeException e) {
                error = "store failed: " + e.getClass().getSimpleName();
            }
            if (error == null) {
                created++;
                ctx.affected(1);
            } else {
                fail(failures, file, spec, error);
            }
        }
        return created;
    }

    private static void fail(Map<String, Long> failures, SourceFile file, MediaVariantSpec spec, String reason) {
        failures.merge(file.mimeType() + "|" + spec.label() + "|" + reason, 1L, Long::sum);
    }

    /** The raster-image files of a media payload: the top-level file and each per-locale file. */
    private static List<SourceFile> rasterFiles(JsonNode payload) {
        List<SourceFile> out = new ArrayList<>();
        if (payload == null || !payload.isObject()) {
            return out;
        }
        addFile(out, payload);
        for (String locale : MediaFiles.localeFileKeys(payload)) {
            addFile(out, payload.path(MediaFiles.LOCALE_FILES).get(locale));
        }
        return out;
    }

    private static void addFile(List<SourceFile> out, JsonNode file) {
        if (file == null || !file.isObject()) {
            return;
        }
        String sha = file.path("blobSha256").asText(null);
        String mime = file.path("mimeType").asText(null);
        if (sha == null || sha.isBlank() || !MediaVariantGenerator.isRasterImage(mime)) {
            return;
        }
        Set<String> names = new HashSet<>();
        file.path("variants").forEach(variant -> names.add(variant.path("name").asText()));
        out.add(new SourceFile(sha, mime, names));
    }
}
