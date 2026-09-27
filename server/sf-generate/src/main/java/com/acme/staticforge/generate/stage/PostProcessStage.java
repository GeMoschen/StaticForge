package com.acme.staticforge.generate.stage;

import com.acme.staticforge.generate.pipeline.OutputFile;
import com.acme.staticforge.generate.postprocess.HtaccessPostProcessor;
import com.acme.staticforge.generate.postprocess.HtmlPrettyPrintProcessor;
import com.acme.staticforge.generate.postprocess.HtmlStubPostProcessor;
import com.acme.staticforge.generate.postprocess.PostProcessor;
import com.acme.staticforge.generate.postprocess.RedirectPostProcessor;
import com.acme.staticforge.generate.postprocess.RobotsPostProcessor;
import com.acme.staticforge.generate.postprocess.SearchIndexPostProcessor;
import com.acme.staticforge.generate.postprocess.SitemapPostProcessor;
import java.util.List;
import org.springframework.stereotype.Service;

/**
 * Runs the post-processing chain (spec §18.2 POST) over the rendered files, deriving the sitemap,
 * robots.txt, search index and the redirect outputs, and (optionally) minifying HTML. Each processor
 * returns a new list — the input is never mutated — and the stage returns the rendered files plus
 * any generated artifacts.
 *
 * <p>The order is fixed and part of the contract (M30.5.1): the HTML pass, then the files that describe the site's
 * pages (sitemap, robots, search index), then the redirect formats ({@code redirects.json}, {@code .htaccess}, the HTML
 * stubs). Redirect stubs are site files written after the site's page lists, so neither lists them.
 */
@Service
public class PostProcessStage {

    private final List<PostProcessor> processors;

    public PostProcessStage(
            HtmlPrettyPrintProcessor html,
            SitemapPostProcessor sitemap,
            RobotsPostProcessor robots,
            SearchIndexPostProcessor searchIndex,
            RedirectPostProcessor redirectsJson,
            HtaccessPostProcessor htaccess,
            HtmlStubPostProcessor stubs) {
        this.processors = List.of(html, sitemap, robots, searchIndex, redirectsJson, htaccess, stubs);
    }

    /** The chain, in the order it runs. */
    public List<PostProcessor> processors() {
        return processors;
    }

    public List<OutputFile> apply(PostProcessContext ctx, List<OutputFile> files) {
        List<OutputFile> current = files;
        for (PostProcessor processor : processors) {
            current = processor.process(ctx, current);
        }
        return current;
    }
}
