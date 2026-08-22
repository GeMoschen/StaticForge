package com.acme.staticforge.generate.postprocess;

import com.acme.staticforge.generate.pipeline.OutputFile;
import com.acme.staticforge.generate.stage.PostProcessContext;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import org.springframework.stereotype.Service;

/**
 * Emits {@code sitemap.xml} (spec §18.2 POST) as a new {@link OutputFile}, listing one
 * {@code <url><loc>} entry per HTML page. Enabled by default; only emits when the context has a
 * {@code baseUrl} and at least one page.
 */
@Service
public final class SitemapPostProcessor implements PostProcessor {

    @Override
    public List<OutputFile> process(PostProcessContext ctx, List<OutputFile> files) {
        if (ctx.baseUrl().isBlank() || ctx.pages().isEmpty()) {
            return files;
        }
        StringBuilder xml = new StringBuilder();
        xml.append("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n");
        xml.append("<urlset xmlns=\"http://www.sitemaps.org/schemas/sitemap/0.9\">\n");
        for (SitePage page : ctx.pages()) {
            xml.append("  <url><loc>")
                    .append(PostProcessSupport.xml(PostProcessSupport.url(ctx.baseUrl(), page.path())))
                    .append("</loc></url>\n");
        }
        xml.append("</urlset>\n");

        List<OutputFile> result = new ArrayList<>(files.size() + 1);
        result.addAll(files);
        result.add(new OutputFile("sitemap.xml", xml.toString().getBytes(StandardCharsets.UTF_8)));
        return result;
    }
}
