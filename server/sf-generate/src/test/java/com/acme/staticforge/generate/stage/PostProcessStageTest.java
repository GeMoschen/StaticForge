package com.acme.staticforge.generate.stage;

import static org.assertj.core.api.Assertions.assertThat;

import com.acme.staticforge.generate.pipeline.OutputFile;
import com.acme.staticforge.generate.RedirectFormat;
import com.acme.staticforge.generate.postprocess.HtaccessPostProcessor;
import com.acme.staticforge.generate.postprocess.HtmlPrettyPrintProcessor;
import com.acme.staticforge.generate.postprocess.HtmlStubPostProcessor;
import com.acme.staticforge.generate.postprocess.PostProcessor;
import com.acme.staticforge.generate.postprocess.Redirect;
import com.acme.staticforge.generate.postprocess.RedirectPostProcessor;
import com.acme.staticforge.generate.postprocess.RobotsPostProcessor;
import com.acme.staticforge.generate.postprocess.SearchIndexPostProcessor;
import com.acme.staticforge.generate.postprocess.SitePage;
import com.acme.staticforge.generate.postprocess.SitemapPostProcessor;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.junit.jupiter.api.Test;

class PostProcessStageTest {

    @Test
    void producesSitemapAndRobots() {
        PostProcessStage stage = stage();

        List<SitePage> pages = List.of(
                new SitePage("p1", "index.html", "web", "Home"),
                new SitePage("p2", "about.html", "web", "About"));

        List<OutputFile> files = List.of(
                new OutputFile("index.html", "<html><body>Home page</body></html>".getBytes(StandardCharsets.UTF_8)),
                new OutputFile("about.html", "<html><body>About us</body></html>".getBytes(StandardCharsets.UTF_8)));

        PostProcessContext ctx =
                new PostProcessContext(1L, "demo", "https://example.com", List.of("web"), pages);

        List<OutputFile> result = stage.apply(ctx, files);
        Map<String, OutputFile> byPath = result.stream()
                .collect(java.util.stream.Collectors.toMap(OutputFile::path, f -> f));

        assertThat(byPath).containsKeys("sitemap.xml", "robots.txt", "search-index.json");

        String sitemap = new String(byPath.get("sitemap.xml").bytes(), StandardCharsets.UTF_8);
        assertThat(sitemap).contains("https://example.com/index.html", "https://example.com/about.html");

        String robots = new String(byPath.get("robots.txt").bytes(), StandardCharsets.UTF_8);
        assertThat(robots).contains("User-agent: *", "Sitemap: https://example.com/sitemap.xml");
    }

    @Test
    void doesNotMutateInputList() {
        PostProcessStage stage = stage();

        List<OutputFile> files = List.of(
                new OutputFile("index.html", "<html></html>".getBytes(StandardCharsets.UTF_8)));

        PostProcessContext ctx = new PostProcessContext(1L, "demo", "https://example.com", List.of("web"),
                List.of(new SitePage("p1", "index.html", "web", "Home")));

        assertThat(files).hasSize(1);
        stage.apply(ctx, files);
        assertThat(files).hasSize(1);
    }

    /**
     * The chain order is part of the contract (M30.5.1): the page lists (sitemap, search index) run before the redirect
     * formats, so a redirect stub — a site file — is listed by neither.
     */
    @Test
    void redirectFormatsRunLastSoThePageListsNeverListAStub() {
        PostProcessStage stage = stage();
        assertThat(stage.processors()).extracting(PostProcessor::getClass).extracting(Class::getSimpleName).containsExactly(
                "HtmlPrettyPrintProcessor",
                "SitemapPostProcessor",
                "RobotsPostProcessor",
                "SearchIndexPostProcessor",
                "RedirectPostProcessor",
                "HtaccessPostProcessor",
                "HtmlStubPostProcessor");

        List<SitePage> pages = List.of(new SitePage("p1", "index.html", "web", "Home"));
        List<OutputFile> files = List.of(
                new OutputFile("index.html", "<html><body>Home</body></html>".getBytes(StandardCharsets.UTF_8)));
        PostProcessContext ctx = new PostProcessContext(1L, "demo", "https://example.com", List.of("web"), pages, false,
                List.of(new Redirect("old/home.html", "index.html", "web", "")), List.of(), Map.of(), null,
                Set.of(RedirectFormat.HTML_STUB, RedirectFormat.HTACCESS, RedirectFormat.JSON), Map.of());

        Map<String, OutputFile> byPath = stage.apply(ctx, files).stream()
                .collect(java.util.stream.Collectors.toMap(OutputFile::path, f -> f));

        assertThat(byPath).containsKeys("old/home.html", ".htaccess", "redirects.json");
        assertThat(new String(byPath.get("sitemap.xml").bytes(), StandardCharsets.UTF_8)).doesNotContain("old/home.html");
        assertThat(new String(byPath.get("search-index.json").bytes(), StandardCharsets.UTF_8)).doesNotContain("old/home");
    }

    private static PostProcessStage stage() {
        return new PostProcessStage(
                new HtmlPrettyPrintProcessor(),
                new SitemapPostProcessor(),
                new RobotsPostProcessor(),
                new SearchIndexPostProcessor(),
                new RedirectPostProcessor(),
                new HtaccessPostProcessor(),
                new HtmlStubPostProcessor());
    }
}
