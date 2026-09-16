package com.acme.staticforge.channel;

import com.acme.staticforge.asset.folder.FolderScope;
import com.fasterxml.jackson.databind.JsonNode;
import java.time.LocalDate;
import java.time.format.DateTimeParseException;
import java.util.Locale;

/**
 * Pure §18.3 output-path/URL expansion algorithm — the placeholder-resolution order (page
 * {@code pathOverride}, then the page template's {@code outputPath} expression, then the
 * project default {@code {folder}{uid}.{ext}}) and placeholder expansion, extracted so it can
 * be shared by both the generation-time path ({@code OutputPathResolver} in sf-generate, which
 * reads a revision-pinned {@code Snapshot}) and any live-repository-backed caller (sf-domain
 * cannot depend on sf-generate, so this class deliberately takes a small structural
 * {@link PageContext} instead of a {@code SnapshotAsset}/{@code Snapshot} pair). Keeping the
 * algorithm in exactly one place guarantees a page's {@code PREVIEW} and {@code GENERATED} URLs
 * are computed identically (`M8.2.2`).
 *
 * <p>This class does not apply output-path syntax normalization (leading-slash stripping,
 * {@code ..} rejection) — that stays with each caller's own notion of an "output path" (e.g.
 * {@code OutputFile.normalize} in sf-generate), since a live URL-registry entry is a URL, not a
 * filesystem-relative output path.
 */
public final class OutputPathExpander {

    private OutputPathExpander() {}

    /**
     * The minimal page shape the expansion algorithm needs: a snapshot-backed and a
     * live-repository-backed page both reduce to this. {@code templatePayload} is the
     * referenced template asset's payload (already resolved by the caller), or {@code null}
     * when the page has no {@code templateRef} or it doesn't resolve.
     */
    public record PageContext(
            String uid, String displayName, String folderPath, JsonNode payload, JsonNode templatePayload) {}

    /**
     * Resolves the (not-yet-syntax-normalized) relative output path for a page in a channel,
     * applying the channel's directory form ({@link ChannelOutputSettings#directoryUrls()}) when set.
     */
    public static String resolvePath(PageContext page, String channel, ChannelOutputSettings settings) {
        String path = expand(expressionFor(page, channel), page, channel, settings);
        if (settings.directoryUrls()) {
            path = prettify(path, settings);
        }
        return path;
    }

    /**
     * Resolves the URL (href) a {@code $CMS_REF(page:...)} should emit for a page: the directory
     * form of its output path ({@link #urlForPath}) when the channel uses directory URLs, otherwise
     * the (unnormalized) output path itself.
     */
    public static String resolveUrl(PageContext page, String channel, ChannelOutputSettings settings) {
        return urlForPath(resolvePath(page, channel, settings), settings);
    }

    /**
     * The URL for a resolved output path. With directory URLs, {@code products/hammer/index.html}
     * links as {@code products/hammer/} and a site-root index as {@code ./} (never blank, which a
     * browser would resolve to the current page); otherwise the path is the URL.
     */
    public static String urlForPath(String path, ChannelOutputSettings settings) {
        if (!settings.directoryUrls()) {
            return path;
        }
        int slash = path.lastIndexOf('/');
        return slash >= 0 ? path.substring(0, slash + 1) : "./";
    }

    /**
     * The (not-yet-syntax-normalized) output path of page {@code pageNumber} ≥ 2 of a paginated page (M21.2.1). The page
     * template's {@code paginationPath.<channel>} pattern when set, expanded with {@code {pageNumber}}, {@code {pagePath}}
     * (page 1's path without its extension) and every page placeholder; otherwise a sibling of page 1 with {@code -N}
     * before the extension ({@code news/blog.html} → {@code news/blog-2.html}, {@code blog/index.html} →
     * {@code blog/index-2.html}), in every channel. Never prettified: the pattern is the file name.
     *
     * @param firstPagePath page 1's resolved path ({@link #resolvePath})
     */
    public static String resolvePaginationPath(
            PageContext page, String channel, ChannelOutputSettings settings, String firstPagePath, int pageNumber) {
        String pagePath = withoutExtension(firstPagePath);
        JsonNode pattern = page.templatePayload() == null
                ? null
                : page.templatePayload().path("paginationPath").path(channel);
        if (pattern == null || !pattern.isTextual() || pattern.asText().isBlank()) {
            return pagePath + "-" + pageNumber + firstPagePath.substring(pagePath.length());
        }
        String expression = pattern.asText()
                .replace("{pageNumber}", String.valueOf(pageNumber))
                .replace("{pagePath}", pagePath);
        return expand(expression, page, channel, settings);
    }

    /**
     * The URL of a pagination page's path: the directory form when the channel uses directory URLs and the file is the
     * channel's index file (as for page 1), otherwise the path itself ({@code blog/index-2.html} stays a file link).
     */
    public static String urlForPaginationPath(String path, ChannelOutputSettings settings) {
        String leaf = path.substring(path.lastIndexOf('/') + 1);
        return settings.directoryUrls() && leaf.equals(settings.indexFileName()) ? urlForPath(path, settings) : path;
    }

    /** {@code news/blog.html} → {@code news/blog}; a leaf without a dot is returned unchanged. */
    private static String withoutExtension(String path) {
        int slash = path.lastIndexOf('/');
        int dot = path.lastIndexOf('.');
        return dot > slash + 1 ? path.substring(0, dot) : path;
    }

    // ------------------------------------------------------------------
    // Resolution order and placeholder expansion
    // ------------------------------------------------------------------

    private static String expressionFor(PageContext page, String channel) {
        JsonNode payload = page.payload();
        if (payload != null) {
            JsonNode override = payload.path("output").path("pathOverride").path(channel);
            if (override.isTextual() && !override.asText().isBlank()) {
                return override.asText();
            }
        }
        JsonNode templatePayload = page.templatePayload();
        if (templatePayload != null) {
            JsonNode expression = templatePayload.path("outputPath").path(channel);
            if (expression.isTextual() && !expression.asText().isBlank()) {
                return expression.asText();
            }
        }
        return "{folder}{uid}.{ext}";
    }

    private static String expand(String expression, PageContext page, String channel, ChannelOutputSettings settings) {
        String folder = relativeFolder(page.folderPath());
        String uid = settings.indexUid().equals(page.uid()) ? settings.indexStem() : (page.uid() == null ? "" : page.uid());
        String ext = settings.extension();
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

    /** The fixed, protected {@code PAGES}-scope wrapper folder every page now lives under
     * (mirrors {@code NAVIGATION}/{@code TEMPLATES}'s own fixed roots) — invisible to output
     * URLs exactly like the project's hidden root itself, so introducing it never changes a
     * single existing page's generated path. */
    private static final String PAGES_ROOT_SEGMENT = FolderScope.PAGES_ROOT_UID + "/";

    /** {@code /products/} → {@code products/}; {@code /} → {@code ""}; the leading, invisible
     * {@code pages_root/} wrapper segment is stripped the same way. Trailing slash preserved. */
    private static String relativeFolder(String folderPath) {
        if (folderPath == null || folderPath.isBlank() || "/".equals(folderPath)) {
            return "";
        }
        String path = folderPath.replace('\\', '/');
        while (path.startsWith("/")) {
            path = path.substring(1);
        }
        if (path.startsWith(PAGES_ROOT_SEGMENT)) {
            path = path.substring(PAGES_ROOT_SEGMENT.length());
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
    private static DateParts dateParts(PageContext page) {
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

    /**
     * {@code products/hammer.html} → {@code products/hammer/index.html}, using the channel's
     * {@code indexFileName}; a path whose file stem already is the index stem stays unchanged.
     */
    private static String prettify(String path, ChannelOutputSettings settings) {
        int slash = path.lastIndexOf('/');
        String dir = slash >= 0 ? path.substring(0, slash + 1) : "";
        String leaf = path.substring(slash + 1);
        int dot = leaf.lastIndexOf('.');
        if (dot < 0) {
            return path;
        }
        String stem = leaf.substring(0, dot);
        if (settings.indexStem().equals(stem)) {
            return path;
        }
        return dir + stem + "/" + settings.indexFileName();
    }

    private record DateParts(String year, String month, String day) {
        static final DateParts EMPTY = new DateParts("", "", "");
    }
}
