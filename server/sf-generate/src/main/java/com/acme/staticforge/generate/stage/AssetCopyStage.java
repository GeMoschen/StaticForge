package com.acme.staticforge.generate.stage;

import com.acme.staticforge.asset.AssetType;
import com.acme.staticforge.asset.media.BlobStore;
import com.acme.staticforge.asset.media.TextMediaTypes;
import com.acme.staticforge.asset.media.MediaPaths;
import com.acme.staticforge.generate.pipeline.OutputFile;
import com.acme.staticforge.generate.render.MediaOutputs;
import com.acme.staticforge.generate.snapshot.Snapshot;
import com.acme.staticforge.generate.snapshot.SnapshotAsset;
import com.fasterxml.jackson.databind.JsonNode;
import com.acme.staticforge.template.diagnostic.Diagnostic;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Collection;
import java.util.Comparator;
import java.util.Deque;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.springframework.stereotype.Service;

/**
 * Copies referenced media into the build (spec §18.2 ASSETS). Reads each blob from the
 * content-addressed {@link BlobStore} using the {@code blobSha256} recorded in the media
 * payload (revision-pinned, so the snapshot — not the live asset — dictates which bytes are
 * copied), emitting one {@link OutputFile} per primary binary and one per named variant. Paths
 * come from {@link MediaPaths} through {@link MediaOutputs}, keeping the ASSETS stage and the renderer's
 * {@code $CMS_REF} resolver in lock-step.
 *
 * <p>What is copied is driven by references: a page rendered in a locale needs the output its media references
 * resolve to in that locale (M27.3.2) — for localized media the locale's own file, or the file of the locale it falls
 * back to. Each output (media, locale it is written for) is written once, from that locale's view.
 *
 * <p>A processed text media file ({@code processCms}, M18.3.1) is rendered through
 * {@link MediaRenderStage} instead of copied, to the same path. The media it depends on (an image in
 * a CSS {@code url()}, a font, another processed stylesheet) joins the copy set in the locale it renders in,
 * transitively: the set is walked to a fixed point with a visited set, so two stylesheets referencing each other
 * terminate. The walk is sequential; only rendering discovers the next dependencies.
 */
@Service
public class AssetCopyStage {

    private final BlobStore blobStore;

    public AssetCopyStage(BlobStore blobStore) {
        this.blobStore = blobStore;
    }

    /** A reference to a media asset from a page or file rendered in {@code locale} ({@code null}: no locales). */
    public record Reference(UUID media, String locale) {}

    /**
     * Builds the ordered list of media files to write: the outputs {@code references} resolve to and the outputs
     * {@code outputs} names directly (processed media an incremental build re-renders), rendering processed media
     * with {@code mediaRenderer} and following their media dependencies.
     */
    public AssetCopyResult copy(
            MediaOutputs mediaOutputs,
            Collection<Reference> references,
            Collection<MediaOutputs.Key> outputs,
            MediaRenderStage.Build mediaRenderer) {
        List<OutputFile> files = new ArrayList<>();
        List<Diagnostic> warnings = new ArrayList<>();
        List<Diagnostic> fileErrors = new ArrayList<>();
        Map<String, MediaOutputs.Key> owners = new HashMap<>();
        Map<MediaOutputs.Key, Set<UUID>> dependencies = new HashMap<>();
        long copied = 0;
        long skipped = 0;

        Deque<MediaOutputs.Output> pending = new ArrayDeque<>();
        for (Reference reference : references == null ? List.<Reference>of() : references) {
            enqueue(pending, mediaOutputs.of(reference.media(), reference.locale()));
        }
        for (MediaOutputs.Key key : outputs == null ? List.<MediaOutputs.Key>of() : outputs) {
            enqueue(pending, mediaOutputs.of(key));
        }
        Set<MediaOutputs.Key> written = new HashSet<>();
        while (!pending.isEmpty()) {
            MediaOutputs.Output output = pending.poll();
            if (!written.add(output.key()) || owners.containsKey(output.path())) {
                // Already written, or a path an earlier output took (a media between a shared and a
                // per-locale release, whose default locale has no prefix): the first output keeps the path.
                continue;
            }
            MediaOutputs.Key key = output.key();
            JsonNode payload = output.payload();

            if (TextMediaTypes.isProcessed(payload)) {
                MediaRenderStage.Result rendered = mediaRenderer.render(output);
                if (rendered.error() != null) {
                    fileErrors.add(rendered.error());
                    continue;
                }
                files.add(rendered.file().toOutputFile());
                owners.put(rendered.file().outputPath(), key);
                Set<UUID> linked = mediaOnly(mediaOutputs.snapshot(), rendered.file().dependencies());
                dependencies.put(key, linked);
                copied++;
                warnings.addAll(rendered.file().diagnostics());
                // Deterministic order: a rendered file's dependency set is unordered. Linked from the locale it renders in.
                linked.stream()
                        .sorted(Comparator.comparing(UUID::toString))
                        .forEach(media -> enqueue(pending, mediaOutputs.of(media, key.locale())));
                continue;
            }

            String primarySha = text(payload, "blobSha256");
            if (primarySha != null) {
                byte[] bytes = readOrNull(primarySha);
                if (bytes != null) {
                    OutputFile file = new OutputFile(output.path(), bytes);
                    files.add(file);
                    owners.put(file.path(), key);
                    copied++;
                } else {
                    skipped++;
                }
            }

            JsonNode variants = payload == null ? null : payload.get("variants");
            if (variants != null && variants.isArray()) {
                for (JsonNode variant : variants) {
                    String name = text(variant, "name");
                    String sha = text(variant, "blobSha256");
                    if (name == null || sha == null) {
                        continue;
                    }
                    byte[] bytes = readOrNull(sha);
                    if (bytes != null) {
                        OutputFile file = new OutputFile(output.variantPath(name), bytes);
                        files.add(file);
                        owners.put(file.path(), key);
                        copied++;
                    } else {
                        skipped++;
                    }
                }
            }
        }

        return new AssetCopyResult(files, copied, skipped, warnings, fileErrors, owners, dependencies);
    }

    private static void enqueue(Deque<MediaOutputs.Output> pending, MediaOutputs.Output output) {
        if (output != null) {
            pending.add(output);
        }
    }

    /** The media among a rendered file's dependencies. */
    static Set<UUID> mediaOnly(Snapshot snapshot, Set<UUID> dependencies) {
        Set<UUID> media = new HashSet<>();
        for (UUID dependency : dependencies) {
            SnapshotAsset asset = snapshot.assetByUuid(dependency);
            if (asset != null && asset.type() == AssetType.MEDIA) {
                media.add(dependency);
            }
        }
        return media;
    }

    private byte[] readOrNull(String sha) {
        try {
            return blobStore.get(sha);
        } catch (RuntimeException e) {
            return null;
        }
    }

    private static String text(JsonNode node, String field) {
        if (node == null) {
            return null;
        }
        JsonNode value = node.get(field);
        return value != null && value.isTextual() && !value.asText().isBlank() ? value.asText() : null;
    }
}
