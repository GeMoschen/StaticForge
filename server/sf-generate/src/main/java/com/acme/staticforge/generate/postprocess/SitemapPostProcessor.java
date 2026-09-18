package com.acme.staticforge.generate.postprocess;

import com.acme.staticforge.generate.pipeline.OutputFile;
import com.acme.staticforge.generate.stage.PostProcessContext;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.stereotype.Service;

/**
 * Emits {@code sitemap.xml} (spec §18.2 POST) as a new {@link OutputFile}, listing one
 * {@code <url><loc>} entry per HTML page. Enabled by default; only emits when the context has a
 * {@code baseUrl} and at least one page. Each output of a paginated page is its own entry (M21.2.2): pages 2..N are
 * self-canonical, so search engines index the items they list.
 *
 * <p>In a localized project (M24.3.2) every entry also carries {@code <xhtml:link rel="alternate"
 * hreflang="…">} for each language the same page exists in, plus {@code x-default} pointing at the
 * project's default language — the standard way to tell a search engine these outputs are
 * translations of one another rather than duplicates.
 */
@Service
public final class SitemapPostProcessor implements PostProcessor {

    @Override
    public List<OutputFile> process(PostProcessContext ctx, List<OutputFile> files) {
        if (ctx.baseUrl().isBlank() || ctx.pages().isEmpty()) {
            return files;
        }
        // Same page, same channel, same page number, different language: each other's alternates.
        Map<AlternateKey, List<SitePage>> alternates = new LinkedHashMap<>();
        boolean localized = false;
        for (SitePage page : ctx.pages()) {
            if (page.locale() != null) {
                localized = true;
                alternates
                        .computeIfAbsent(
                                new AlternateKey(page.uid(), page.channel(), page.pageNumber()),
                                key -> new ArrayList<>())
                        .add(page);
            }
        }

        StringBuilder xml = new StringBuilder();
        xml.append("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n");
        xml.append("<urlset xmlns=\"http://www.sitemaps.org/schemas/sitemap/0.9\"");
        if (localized) {
            xml.append(" xmlns:xhtml=\"http://www.w3.org/1999/xhtml\"");
        }
        xml.append(">\n");
        for (SitePage page : ctx.pages()) {
            List<SitePage> siblings = page.locale() == null
                    ? List.of()
                    : alternates.getOrDefault(
                            new AlternateKey(page.uid(), page.channel(), page.pageNumber()), List.of());
            if (siblings.size() < 2) {
                xml.append("  <url><loc>")
                        .append(PostProcessSupport.xml(PostProcessSupport.url(ctx.baseUrl(), page.path())))
                        .append("</loc></url>\n");
                continue;
            }
            xml.append("  <url>\n    <loc>")
                    .append(PostProcessSupport.xml(PostProcessSupport.url(ctx.baseUrl(), page.path())))
                    .append("</loc>\n");
            for (SitePage sibling : siblings) {
                appendAlternate(xml, ctx.baseUrl(), sibling.locale(), sibling.path());
            }
            siblings.stream()
                    .filter(sibling -> sibling.locale().equals(ctx.defaultLocale()))
                    .findFirst()
                    .ifPresent(fallback -> appendAlternate(xml, ctx.baseUrl(), "x-default", fallback.path()));
            xml.append("  </url>\n");
        }
        xml.append("</urlset>\n");

        List<OutputFile> result = new ArrayList<>(files.size() + 1);
        result.addAll(files);
        result.add(new OutputFile("sitemap.xml", xml.toString().getBytes(StandardCharsets.UTF_8)));
        return result;
    }

    private static void appendAlternate(StringBuilder xml, String baseUrl, String hreflang, String path) {
        xml.append("    <xhtml:link rel=\"alternate\" hreflang=\"")
                .append(PostProcessSupport.xml(hreflang))
                .append("\" href=\"")
                .append(PostProcessSupport.xml(PostProcessSupport.url(baseUrl, path)))
                .append("\"/>\n");
    }

    /** What makes two outputs translations of each other rather than different pages. */
    private record AlternateKey(String uid, String channel, Integer pageNumber) {}
}
