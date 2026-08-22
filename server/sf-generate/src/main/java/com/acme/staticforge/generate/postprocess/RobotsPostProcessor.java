package com.acme.staticforge.generate.postprocess;

import com.acme.staticforge.generate.pipeline.OutputFile;
import com.acme.staticforge.generate.stage.PostProcessContext;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import org.springframework.stereotype.Service;

/**
 * Emits {@code robots.txt} (spec §18.2 POST) with a {@code User-agent} allow-all rule, a
 * {@code Sitemap} reference, and any {@code Disallow} paths from the context.
 */
@Service
public final class RobotsPostProcessor implements PostProcessor {

    @Override
    public List<OutputFile> process(PostProcessContext ctx, List<OutputFile> files) {
        if (ctx.baseUrl().isBlank()) {
            return files;
        }
        StringBuilder txt = new StringBuilder();
        txt.append("User-agent: *\n");
        txt.append("Allow: /\n");
        for (String path : ctx.disallow()) {
            if (!path.isBlank()) {
                txt.append("Disallow: ").append(path).append('\n');
            }
        }
        txt.append("Sitemap: ").append(PostProcessSupport.url(ctx.baseUrl(), "sitemap.xml")).append('\n');

        List<OutputFile> result = new ArrayList<>(files.size() + 1);
        result.addAll(files);
        result.add(new OutputFile("robots.txt", txt.toString().getBytes(StandardCharsets.UTF_8)));
        return result;
    }
}
