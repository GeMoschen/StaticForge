package com.acme.staticforge.generate.postprocess;

import static org.assertj.core.api.Assertions.assertThat;

import com.acme.staticforge.generate.pipeline.OutputFile;
import com.acme.staticforge.generate.stage.PostProcessContext;
import java.nio.charset.StandardCharsets;
import java.util.List;
import org.junit.jupiter.api.Test;

/** {@code nav.noIndex} keeps a page out of {@code sitemap.xml} (M30.2.2, epic decision 12), not out of the search index. */
class NoIndexSitemapTest {

    private static final String BASE = "https://example.com";

    @Test
    void everyPageNumberOfANoIndexPageIsLeftOut() {
        List<SitePage> pages = List.of(
                new SitePage("about", "about.html", "html", "About"),
                new SitePage("blog", "blog.html", "html", "Blog", 1, 3, null, true),
                new SitePage("blog", "blog-2.html", "html", "Blog", 2, 3, null, true),
                new SitePage("blog", "blog-3.html", "html", "Blog", 3, 3, null, true));
        PostProcessContext ctx = new PostProcessContext(1L, "p", BASE, List.of("html"), pages);

        String sitemap = output(new SitemapPostProcessor().process(ctx, List.of()), "sitemap.xml");

        assertThat(sitemap).contains("<loc>https://example.com/about.html</loc>").doesNotContain("blog");
        // Site search is the site's own: the search index still lists every output.
        String index = output(new SearchIndexPostProcessor().process(ctx, List.of()), "search-index.json");
        assertThat(index).contains("blog.html", "blog-2.html", "blog-3.html");
    }

    @Test
    void aNoIndexPageIsLeftOutInEveryLanguageAndAsAnAlternate() {
        List<SitePage> pages = List.of(
                new SitePage("home", "de/index.html", "html", "Start", null, null, "de", false),
                new SitePage("home", "en/index.html", "html", "Home", null, null, "en", false),
                new SitePage("news", "de/news.html", "html", "News", 1, 2, "de", true),
                new SitePage("news", "de/news-2.html", "html", "News", 2, 2, "de", true),
                new SitePage("news", "en/news.html", "html", "News", 1, 2, "en", true),
                new SitePage("news", "en/news-2.html", "html", "News", 2, 2, "en", true));
        PostProcessContext ctx = localized(pages);

        String sitemap = output(new SitemapPostProcessor().process(ctx, List.of()), "sitemap.xml");

        assertThat(sitemap)
                .contains("<loc>https://example.com/de/index.html</loc>", "<loc>https://example.com/en/index.html</loc>")
                .doesNotContain("news");
    }

    @Test
    void aLanguageThatSetsNoIndexIsNoAlternateOfTheOthers() {
        List<SitePage> pages = List.of(
                new SitePage("about", "de/about.html", "html", "Über uns", null, null, "de", false),
                new SitePage("about", "en/about.html", "html", "About", null, null, "en", true),
                new SitePage("about", "fr/about.html", "html", "À propos", null, null, "fr", false));
        PostProcessContext ctx = localized(pages);

        String sitemap = output(new SitemapPostProcessor().process(ctx, List.of()), "sitemap.xml");

        assertThat(sitemap)
                .contains(
                        "<loc>https://example.com/de/about.html</loc>",
                        "<loc>https://example.com/fr/about.html</loc>",
                        "hreflang=\"fr\" href=\"https://example.com/fr/about.html\"",
                        "hreflang=\"x-default\" href=\"https://example.com/de/about.html\"")
                .doesNotContain("en/about.html", "hreflang=\"en\"");
    }

    @Test
    void aSiteWhosePagesAreAllNoIndexStillGetsAValidEmptySitemap() {
        PostProcessContext ctx = new PostProcessContext(1L, "p", BASE, List.of("html"),
                List.of(new SitePage("draft", "draft.html", "html", "Draft", null, null, null, true)));

        String sitemap = output(new SitemapPostProcessor().process(ctx, List.of()), "sitemap.xml");

        assertThat(sitemap).contains("<urlset").doesNotContain("<url>");
    }

    private static PostProcessContext localized(List<SitePage> pages) {
        return new PostProcessContext(1L, "p", BASE, List.of("html"), pages, false, List.of(), List.of(),
                java.util.Map.of(), "de");
    }

    private static String output(List<OutputFile> files, String path) {
        return files.stream()
                .filter(file -> file.path().equals(path))
                .map(file -> new String(file.bytes(), StandardCharsets.UTF_8))
                .findFirst()
                .orElseThrow();
    }
}
