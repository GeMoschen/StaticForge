package com.acme.staticforge.generate.stage;

import com.acme.staticforge.generate.pipeline.OutputFile;
import com.acme.staticforge.generate.postprocess.HtmlPrettyPrintProcessor;
import com.acme.staticforge.generate.postprocess.PostProcessor;
import com.acme.staticforge.generate.postprocess.RedirectPostProcessor;
import com.acme.staticforge.generate.postprocess.RobotsPostProcessor;
import com.acme.staticforge.generate.postprocess.SearchIndexPostProcessor;
import com.acme.staticforge.generate.postprocess.SitemapPostProcessor;
import java.util.List;
import org.springframework.stereotype.Service;

/**
 * Runs the post-processing chain (spec §18.2 POST) over the rendered files, deriving the sitemap,
 * robots.txt, redirect manifest and search index, and (optionally) minifying HTML. Each processor
 * returns a new list — the input is never mutated — and the stage returns the rendered files plus
 * any generated artifacts.
 */
@Service
public class PostProcessStage {

    private final List<PostProcessor> processors;

    public PostProcessStage(
            HtmlPrettyPrintProcessor html,
            SitemapPostProcessor sitemap,
            RobotsPostProcessor robots,
            RedirectPostProcessor redirects,
            SearchIndexPostProcessor searchIndex) {
        this.processors = List.of(html, sitemap, robots, redirects, searchIndex);
    }

    public List<OutputFile> apply(PostProcessContext ctx, List<OutputFile> files) {
        List<OutputFile> current = files;
        for (PostProcessor processor : processors) {
            current = processor.process(ctx, current);
        }
        return current;
    }
}
