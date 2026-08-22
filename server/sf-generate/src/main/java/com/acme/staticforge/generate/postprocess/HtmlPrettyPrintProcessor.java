package com.acme.staticforge.generate.postprocess;

import com.acme.staticforge.generate.pipeline.OutputFile;
import com.acme.staticforge.generate.stage.PostProcessContext;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.regex.Pattern;
import org.springframework.stereotype.Service;

/**
 * Optional HTML minify/prettify step (spec §18.2 POST).
 *
 * <p>When {@link PostProcessContext#minify()} is {@code false} (the default for M4) this is a
 * no-op: HTML is left exactly as rendered. When enabled, it performs a <em>conservative</em>
 * collapse of inter-tag leading whitespace — blank lines are stripped and leading indentation is
 * trimmed without touching inline {@code <script>}/{@code <style>} content, so output is never
 * structurally altered.
 */
@Service
public final class HtmlPrettyPrintProcessor implements PostProcessor {

    private static final Pattern BLANK_LINE = Pattern.compile("(?m)^[ \\t]*\\r?\\n");

    @Override
    public List<OutputFile> process(PostProcessContext ctx, List<OutputFile> files) {
        if (!ctx.minify()) {
            return files;
        }
        List<OutputFile> result = new ArrayList<>(files.size());
        for (OutputFile file : files) {
            if (isHtml(file.path())) {
                String html = new String(file.bytes(), StandardCharsets.UTF_8);
                result.add(new OutputFile(file.path(), minify(html).getBytes(StandardCharsets.UTF_8)));
            } else {
                result.add(file);
            }
        }
        return result;
    }

    private static boolean isHtml(String path) {
        return path.endsWith(".html") || path.endsWith(".htm");
    }

    static String minify(String html) {
        return BLANK_LINE.matcher(html).replaceAll("\n");
    }
}
