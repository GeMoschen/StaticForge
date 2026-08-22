package com.acme.staticforge.generate.render;

import com.acme.staticforge.common.ProblemFactory;
import com.acme.staticforge.common.SfException;
import com.acme.staticforge.generate.pipeline.OutputFile;
import com.acme.staticforge.generate.plan.PlanEntry;
import com.acme.staticforge.generate.snapshot.Snapshot;
import com.acme.staticforge.generate.snapshot.SnapshotAsset;
import com.fasterxml.jackson.databind.JsonNode;
import java.time.LocalDate;
import java.time.format.DateTimeParseException;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;

/**
 * Resolves each page's output path for a channel by the §18.3 order — page
 * {@code pathOverride}, then the page template's {@code outputPath} expression, then the
 * project default {@code {folder}{uid}.{ext}} — and expands the placeholder set. A resolver
 * is stateful per generation run (it caches first-path ownership for collision reporting),
 * so build one via {@link #forSnapshot} for each run rather than as a shared singleton.
 */
public final class OutputPathResolver {

    /** The default {@code indexUid}; a page whose UID equals this renders as {@code index.ext}. */
    public static final String DEFAULT_INDEX_UID = "index";

    /** {@code urlStrategy} value that turns {@code /products/hammer.html} into the pretty form. */
    public static final String STRATEGY_PRETTY = "PRETTY";

    private static final String STRATEGY_RELATIVE = "RELATIVE";

    private final Snapshot snapshot;
    private final String indexUid;
    private final boolean trailingSlash;
    private final String urlStrategy;

    private volatile Map<String, UUID> collisionOwners = Map.of();

    private OutputPathResolver(Snapshot snapshot, String indexUid, boolean trailingSlash, String urlStrategy) {
        this.snapshot = snapshot;
        this.indexUid = indexUid == null || indexUid.isBlank() ? DEFAULT_INDEX_UID : indexUid;
        this.trailingSlash = trailingSlash;
        this.urlStrategy = urlStrategy == null || urlStrategy.isBlank() ? STRATEGY_RELATIVE : urlStrategy;
    }

    /** Builds a resolver for one generation run, pinned to the given snapshot. */
    public static OutputPathResolver forSnapshot(
            Snapshot snapshot, String indexUid, boolean trailingSlash, String urlStrategy) {
        return new OutputPathResolver(snapshot, indexUid, trailingSlash, urlStrategy);
    }

    /**
     * Resolves the relative (no leading slash) output path for a page in a channel.
     *
     * @throws SfException (not-found) when the page is absent from the snapshot
     */
    public String resolvePagePath(UUID pageUuid, String channel) {
        SnapshotAsset page = snapshot.assetByUuid(pageUuid);
        if (page == null) {
            throw new SfException(ProblemFactory.notFound("Page not found in snapshot."));
        }
        String path = expand(expressionFor(page, channel), page, channel);
        if (isPretty() && trailingSlash) {
            path = prettify(path);
        }
        return OutputFile.normalize(path);
    }

    /**
     * Resolves the URL (href) a {@code $CMS_REF(page:...)} should emit for a page. With
     * {@code urlStrategy=PRETTY} and {@code trailingSlash} this is the directory form
     * ({@code products/hammer/}); otherwise it matches the concrete output path.
     */
    public String resolvePageUrl(UUID pageUuid, String channel) {
        String path = resolvePagePath(pageUuid, channel);
        if (!isPretty() || !trailingSlash) {
            return path;
        }
        int slash = path.lastIndexOf('/');
        return slash >= 0 ? path.substring(0, slash + 1) : "";
    }

    /** The file extension for a channel key (html→html, markdown→md, else the key itself). */
    public static String extensionForChannel(String channel) {
        if ("markdown".equals(channel)) {
            return "md";
        }
        return channel == null || channel.isBlank() ? "html" : channel;
    }

    /** {@code true} when the run uses the PRETTY URL strategy. */
    public boolean isPretty() {
        return STRATEGY_PRETTY.equalsIgnoreCase(urlStrategy);
    }

    /** First-resolved owner (path → page UUID) of each output path; populated by {@link #findCollisions}. */
    public Map<String, UUID> collisionOwners() {
        return collisionOwners;
    }

    /**
     * Detects output-path collisions among resolved entries: two distinct pages mapping to the
     * same path. Records first-path ownership and returns one {@link Collision} per colliding
     * path (each naming the first two distinct asset UIDs).
     */
    public List<Collision> findCollisions(List<PlanEntry> entries) {
        Map<String, UUID> owners = new HashMap<>();
        List<Collision> collisions = new ArrayList<>();
        for (PlanEntry entry : entries == null ? List.<PlanEntry>of() : entries) {
            UUID previous = owners.putIfAbsent(entry.outputPath(), entry.pageUuid());
            if (previous != null && !previous.equals(entry.pageUuid())) {
                collisions.add(new Collision(entry.outputPath(), uidOf(previous), uidOf(entry.pageUuid())));
            }
        }
        this.collisionOwners = Map.copyOf(owners);
        return List.copyOf(collisions);
    }

    /** A single output-path collision between two distinct pages. */
    public record Collision(String path, String uidA, String uidB) {}

    // ------------------------------------------------------------------
    // Resolution order and placeholder expansion
    // ------------------------------------------------------------------

    private String expressionFor(SnapshotAsset page, String channel) {
        JsonNode payload = page.payload();
        if (payload != null) {
            JsonNode override = payload.path("output").path("pathOverride").path(channel);
            if (override.isTextual() && !override.asText().isBlank()) {
                return override.asText();
            }
        }
        SnapshotAsset template = templateOf(page);
        if (template != null && template.payload() != null) {
            JsonNode expression = template.payload().path("outputPath").path(channel);
            if (expression.isTextual() && !expression.asText().isBlank()) {
                return expression.asText();
            }
        }
        return "{folder}{uid}.{ext}";
    }

    private SnapshotAsset templateOf(SnapshotAsset page) {
        JsonNode payload = page.payload();
        if (payload == null) {
            return null;
        }
        String ref = payload.path("templateRef").asText();
        if (ref.isBlank()) {
            return null;
        }
        try {
            return snapshot.assetByUuid(UUID.fromString(ref));
        } catch (IllegalArgumentException e) {
            return null;
        }
    }

    private String expand(String expression, SnapshotAsset page, String channel) {
        String folder = relativeFolder(page.folderPath());
        String uid = indexUid.equals(page.uid()) ? DEFAULT_INDEX_UID : (page.uid() == null ? "" : page.uid());
        String ext = extensionForChannel(channel);
        DateParts date = dateParts(page);
        return expression
                .replace("{displayNameSlug}", slugify(page.displayName()))
                .replace("{folder}", folder)
                .replace("{uid}", uid)
                .replace("{ext}", ext)
                .replace("{channel}", channel)
                .replace("{year}", date.year)
                .replace("{month}", date.month)
                .replace("{day}", date.day);
    }

    /** {@code /products/} → {@code products/}; {@code /} → {@code ""}. Trailing slash preserved. */
    private static String relativeFolder(String folderPath) {
        if (folderPath == null || folderPath.isBlank() || "/".equals(folderPath)) {
            return "";
        }
        String path = folderPath.replace('\\', '/');
        while (path.startsWith("/")) {
            path = path.substring(1);
        }
        if (path.isEmpty()) {
            return "";
        }
        return path.endsWith("/") ? path : path + "/";
    }

    /** Lowercased, non-alphanumerics → {@code -}, trimmed of leading/trailing dashes. */
    private static String slugify(String displayName) {
        if (displayName == null) {
            return "";
        }
        StringBuilder out = new StringBuilder(displayName.length());
        for (char c : displayName.toLowerCase(Locale.ROOT).toCharArray()) {
            if (Character.isLetterOrDigit(c)) {
                out.append(c);
            } else if (out.length() > 0 && out.charAt(out.length() - 1) != '-') {
                out.append('-');
            }
        }
        while (out.length() > 0 && out.charAt(out.length() - 1) == '-') {
            out.deleteCharAt(out.length() - 1);
        }
        return out.toString();
    }

    /** {@code year}/{@code month}/{@code day} from {@code nav.date} or {@code publishedOn} (ISO date). */
    private static DateParts dateParts(SnapshotAsset page) {
        JsonNode payload = page.payload();
        String value = null;
        if (payload != null) {
            JsonNode navDate = payload.path("nav").path("date");
            if (navDate.isTextual() && !navDate.asText().isBlank()) {
                value = navDate.asText();
            } else {
                JsonNode publishedOn = payload.path("publishedOn");
                if (publishedOn.isTextual()) {
                    value = publishedOn.asText();
                }
            }
        }
        if (value == null || value.isBlank()) {
            return DateParts.EMPTY;
        }
        String iso = value.trim().length() >= 10 ? value.trim().substring(0, 10) : value.trim();
        try {
            LocalDate date = LocalDate.parse(iso);
            return new DateParts(
                    String.valueOf(date.getYear()),
                    String.format(Locale.ROOT, "%02d", date.getMonthValue()),
                    String.format(Locale.ROOT, "%02d", date.getDayOfMonth()));
        } catch (DateTimeParseException e) {
            return DateParts.EMPTY;
        }
    }

    /** {@code products/hammer.html} → {@code products/hammer/index.html} (already-index paths unchanged). */
    private static String prettify(String path) {
        int slash = path.lastIndexOf('/');
        String dir = slash >= 0 ? path.substring(0, slash + 1) : "";
        String leaf = path.substring(slash + 1);
        int dot = leaf.lastIndexOf('.');
        if (dot < 0) {
            return path;
        }
        String stem = leaf.substring(0, dot);
        if ("index".equals(stem)) {
            return path;
        }
        return dir + stem + "/index" + leaf.substring(dot);
    }

    private String uidOf(UUID pageUuid) {
        SnapshotAsset page = snapshot.assetByUuid(pageUuid);
        return page == null || page.uid() == null ? "" : page.uid();
    }

    private record DateParts(String year, String month, String day) {
        static final DateParts EMPTY = new DateParts("", "", "");
    }
}
