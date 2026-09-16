package com.acme.staticforge.generate.postprocess;

import static org.assertj.core.api.Assertions.assertThat;

import com.acme.staticforge.generate.pipeline.OutputFile;
import com.acme.staticforge.generate.stage.PostProcessContext;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.nio.charset.StandardCharsets;
import java.util.List;
import org.junit.jupiter.api.Test;

/** Sitemap and search index entries of a paginated page's outputs (M21.2.2). */
class PaginatedSitePagesTest {

    private final List<SitePage> pages = List.of(
            new SitePage("about", "about.html", "html", "About"),
            new SitePage("blog", "blog.html", "html", "Blog", 1, 3),
            new SitePage("blog", "blog-2.html", "html", "Blog", 2, 3),
            new SitePage("blog", "blog-3.html", "html", "Blog", 3, 3));

    private final PostProcessContext ctx = new PostProcessContext(1L, "p", "https://example.com", List.of("html"), pages);

    @Test
    void theSitemapListsEveryOutput() {
        String sitemap = output(new SitemapPostProcessor().process(ctx, List.of()), "sitemap.xml");

        assertThat(sitemap).contains(
                "<loc>https://example.com/about.html</loc>",
                "<loc>https://example.com/blog.html</loc>",
                "<loc>https://example.com/blog-2.html</loc>",
                "<loc>https://example.com/blog-3.html</loc>");
    }

    @Test
    void theSearchIndexHasOneEntryPerOutputWithItsPageNumber() throws Exception {
        List<OutputFile> files = List.of(
                new OutputFile("blog-2.html", "<p>Second page</p>".getBytes(StandardCharsets.UTF_8)));
        JsonNode index = new ObjectMapper().readTree(output(new SearchIndexPostProcessor().process(ctx, files), "search-index.json"));

        assertThat(index).hasSize(4);
        assertThat(index.get(0).has("pageNumber")).isFalse();
        assertThat(index.get(1).path("pageNumber").asInt()).isEqualTo(1);
        assertThat(index.get(1).path("title").asText()).isEqualTo("Blog");
        assertThat(index.get(2).path("uid").asText()).isEqualTo("blog");
        assertThat(index.get(2).path("pageNumber").asInt()).isEqualTo(2);
        assertThat(index.get(2).path("title").asText()).isEqualTo("Blog – page 2");
        assertThat(index.get(2).path("text").asText()).isEqualTo("Second page");
    }

    private static String output(List<OutputFile> files, String path) {
        return files.stream()
                .filter(file -> file.path().equals(path))
                .map(file -> new String(file.bytes(), StandardCharsets.UTF_8))
                .findFirst()
                .orElseThrow();
    }
}
