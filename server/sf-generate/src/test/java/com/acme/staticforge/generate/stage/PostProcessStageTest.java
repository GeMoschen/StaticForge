package com.acme.staticforge.generate.stage;

import static org.assertj.core.api.Assertions.assertThat;

import com.acme.staticforge.generate.pipeline.OutputFile;
import com.acme.staticforge.generate.postprocess.HtmlPrettyPrintProcessor;
import com.acme.staticforge.generate.postprocess.RedirectPostProcessor;
import com.acme.staticforge.generate.postprocess.RobotsPostProcessor;
import com.acme.staticforge.generate.postprocess.SearchIndexPostProcessor;
import com.acme.staticforge.generate.postprocess.SitePage;
import com.acme.staticforge.generate.postprocess.SitemapPostProcessor;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

class PostProcessStageTest {

    @Test
    void producesSitemapAndRobots() {
        PostProcessStage stage = new PostProcessStage(
                new HtmlPrettyPrintProcessor(),
                new SitemapPostProcessor(),
                new RobotsPostProcessor(),
                new RedirectPostProcessor(),
                new SearchIndexPostProcessor());

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
        PostProcessStage stage = new PostProcessStage(
                new HtmlPrettyPrintProcessor(),
                new SitemapPostProcessor(),
                new RobotsPostProcessor(),
                new RedirectPostProcessor(),
                new SearchIndexPostProcessor());

        List<OutputFile> files = List.of(
                new OutputFile("index.html", "<html></html>".getBytes(StandardCharsets.UTF_8)));

        PostProcessContext ctx = new PostProcessContext(1L, "demo", "https://example.com", List.of("web"),
                List.of(new SitePage("p1", "index.html", "web", "Home")));

        assertThat(files).hasSize(1);
        stage.apply(ctx, files);
        assertThat(files).hasSize(1);
    }
}
