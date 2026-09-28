package com.acme.staticforge.generate.postprocess;

import com.acme.staticforge.channel.ChannelOutputSettings;
import com.acme.staticforge.generate.RedirectFormat;
import com.acme.staticforge.generate.pipeline.OutputFile;
import com.acme.staticforge.generate.stage.PostProcessContext;
import com.acme.staticforge.redirect.RedirectPaths;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;
import org.springframework.stereotype.Service;

/**
 * Writes the build's redirects for Apache (M30.5.1, epic decision 18 as amended by the user on 2026-09-27): a marked
 * block in the site-root {@code .htaccess},
 *
 * <pre>
 * # BEGIN StaticForge redirects
 * RedirectMatch 301 "^/old page\.html$" "/new%20page.html"
 * # END StaticForge redirects
 * </pre>
 *
 * one line per source URL path, sorted. Each rule is an anchored {@code RedirectMatch}, so it matches its source path
 * exactly — never the URLs below a directory source, as {@code Redirect}'s prefix match would. Paths are the URL paths
 * visitors request: {@code /} + the output path, below the path of the target's {@code baseUrl} when it has one, and a
 * directory ({@code /about/}) for an index file when the channel uses pretty URLs with a trailing slash. A directory
 * source also matches its index file ({@code ^/about/(?:index\.html)?$}): the old site served the page under both
 * URLs, and a visitor may have either.
 *
 * <p><b>Escaping.</b> The source is the <em>decoded</em> path (mod_alias matches the %-decoded request path) with every
 * regex metacharacter escaped by a backslash. The target is percent-encoded (it is sent as the {@code Location}), an
 * absolute URL as it is; {@code $}, {@code &} and {@code \} in it are backslash-escaped, since mod_alias substitutes
 * {@code $1}-style backreferences (and, in some versions, {@code &}) into it. Both are then double-quoted with
 * {@code "} written as {@code \"}: Apache's directive tokenizer drops a backslash only before the quote, so every other
 * escape reaches the regex engine and the substitution as written. Registry paths never contain a control character.
 *
 * <p><b>An existing {@code .htaccess}.</b> When the build has a {@code .htaccess} of its own — a page whose template
 * writes one — the block is appended to it instead of replacing it; a block a previous build appended (a carried file)
 * is removed first, so there is always exactly one. Without the format, such a stale block is removed and nothing is
 * appended.
 */
@Service
public final class HtaccessPostProcessor implements PostProcessor {

    /** The file Apache reads. */
    public static final String PATH = ".htaccess";

    static final String BEGIN = "# BEGIN StaticForge redirects";
    static final String END = "# END StaticForge redirects";

    /** The PCRE metacharacters outside a character class. */
    private static final String REGEX_META = "\\.+*?^$|()[]{}";

    @Override
    public List<OutputFile> process(PostProcessContext ctx, List<OutputFile> files) {
        int existingAt = -1;
        for (int i = 0; i < files.size(); i++) {
            if (files.get(i).path().equals(PATH)) {
                existingAt = i;
            }
        }
        boolean writes = ctx.writes(RedirectFormat.HTACCESS);
        if (existingAt < 0 && !writes) {
            return files;
        }
        String existing = existingAt < 0 ? "" : withoutBlock(new String(files.get(existingAt).bytes(), StandardCharsets.UTF_8));
        StringBuilder content = new StringBuilder(existing);
        if (writes) {
            if (!content.isEmpty() && content.charAt(content.length() - 1) != '\n') {
                content.append('\n');
            }
            content.append(block(ctx));
        }
        List<OutputFile> result = new ArrayList<>(files);
        OutputFile file = new OutputFile(PATH, content.toString().getBytes(StandardCharsets.UTF_8));
        if (existingAt < 0) {
            result.add(file);
        } else {
            result.set(existingAt, file);
        }
        return result;
    }

    /** The marked block of {@code ctx}'s redirects. */
    static String block(PostProcessContext ctx) {
        Map<String, String> lines = new TreeMap<>();
        for (Redirect redirect : ctx.redirects()) {
            ChannelOutputSettings settings = ctx.settingsFor(redirect.channel());
            String from = RedirectLinks.urlPath(ctx.baseUrl(), redirect.from(), settings, false);
            String to = RedirectLinks.isAbsolute(redirect.to())
                    ? redirect.to()
                    : RedirectLinks.urlPath(ctx.baseUrl(), RedirectPaths.pathOf(redirect.to()), settings, true)
                            + RedirectLinks.suffix(redirect.to());
            // The first redirect of a source path wins, as Apache's first matching directive would.
            lines.putIfAbsent(from, "RedirectMatch " + RedirectLinks.STATUS + " "
                    + quoted(pattern(from, settings.indexFileName())) + " "
                    + quoted(substitution(to)));
        }
        StringBuilder block = new StringBuilder(BEGIN).append('\n');
        lines.values().forEach(line -> block.append(line).append('\n'));
        return block.append(END).append('\n').toString();
    }

    /**
     * The anchored regex matching exactly {@code path}: {@code ^} + the path with its metacharacters escaped + {@code $}.
     * A directory path ({@code /about/}) also matches its index file {@code indexFileName} ({@code /about/index.html}).
     */
    static String pattern(String path, String indexFileName) {
        StringBuilder regex = new StringBuilder(path.length() + 8).append('^').append(escaped(path));
        if (path.endsWith("/") && indexFileName != null && !indexFileName.isBlank()) {
            regex.append("(?:").append(escaped(indexFileName)).append(")?");
        }
        return regex.append('$').toString();
    }

    private static String escaped(String literal) {
        StringBuilder out = new StringBuilder(literal.length() + 4);
        for (int i = 0; i < literal.length(); i++) {
            char c = literal.charAt(i);
            if (REGEX_META.indexOf(c) >= 0) {
                out.append('\\');
            }
            out.append(c);
        }
        return out.toString();
    }

    /** {@code target} as a literal mod_alias substitution: {@code $}, {@code &} and {@code \} backslash-escaped. */
    static String substitution(String target) {
        StringBuilder out = new StringBuilder(target.length() + 4);
        for (int i = 0; i < target.length(); i++) {
            char c = target.charAt(i);
            if (c == '$' || c == '&' || c == '\\') {
                out.append('\\');
            }
            out.append(c);
        }
        return out.toString();
    }

    private static String quoted(String value) {
        return "\"" + value.replace("\"", "\\\"") + "\"";
    }

    /** {@code content} without a block a previous build appended (and the line break before it). */
    static String withoutBlock(String content) {
        int begin = content.indexOf(BEGIN);
        if (begin < 0) {
            return content;
        }
        int end = content.indexOf(END, begin);
        if (end < 0) {
            return content;
        }
        int after = end + END.length();
        if (after < content.length() && content.charAt(after) == '\r') {
            after++;
        }
        if (after < content.length() && content.charAt(after) == '\n') {
            after++;
        }
        return content.substring(0, begin) + content.substring(after);
    }
}
