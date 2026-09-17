package com.acme.staticforge.generate.postprocess;

import com.acme.staticforge.generate.pipeline.OutputFile;
import com.acme.staticforge.generate.stage.PostProcessContext;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.regex.Pattern;
import org.springframework.stereotype.Service;

/**
 * Emits {@code search-index.json} (spec §18.2 POST), an array of {@code {uid, path, channel,
 * title, text}} entries built from {@code ctx.pages()} with a crude text snippet extracted by
 * stripping tags from the matching HTML file for each page. Enabled by default but cheap.
 *
 * <p>Every output of a paginated page is an entry (M21.2.2) with the page's uid and a {@code pageNumber}, so a client
 * can collapse them; pages 2..N get the title suffix {@code " – page n"}. The field is omitted for other pages.
 *
 * <p>A page carried forward from the base build (M22.4.1) isn't among the files; its text is the base build's entry for
 * the same path ({@link PostProcessContext#carriedText()}), extracted from the very bytes the carried file holds.
 */
@Service
public final class SearchIndexPostProcessor implements PostProcessor {

    private static final Pattern TAG = Pattern.compile("<[^>]*>");
    private static final Pattern WS = Pattern.compile("\\s+");

    @Override
    public List<OutputFile> process(PostProcessContext ctx, List<OutputFile> files) {
        Map<String, OutputFile> byPath = indexHtml(files);
        ArrayNode arr = PostProcessSupport.json.createArrayNode();
        for (SitePage page : ctx.pages()) {
            OutputFile html = byPath.get(page.path());
            ObjectNode node = PostProcessSupport.json.createObjectNode();
            node.put("uid", page.uid());
            node.put("path", page.path());
            node.put("channel", page.channel());
            node.put("title", page.pageNumber() != null && page.pageNumber() > 1
                    ? page.title() + " – page " + page.pageNumber()
                    : page.title());
            if (page.pageNumber() != null) {
                node.put("pageNumber", page.pageNumber());
            }
            node.put("text", html == null ? ctx.carriedText().getOrDefault(page.path(), "") : extractText(html.bytes()));
            arr.add(node);
        }
        List<OutputFile> result = new ArrayList<>(files.size() + 1);
        result.addAll(files);
        result.add(new OutputFile("search-index.json", PostProcessSupport.jsonBytes(arr)));
        return result;
    }

    private Map<String, OutputFile> indexHtml(List<OutputFile> files) {
        java.util.HashMap<String, OutputFile> map = new java.util.HashMap<>();
        for (OutputFile file : files) {
            if (file.path().endsWith(".html") || file.path().endsWith(".htm")) {
                map.put(file.path(), file);
            }
        }
        return map;
    }

    static String extractText(byte[] htmlBytes) {
        String html = new String(htmlBytes, StandardCharsets.UTF_8);
        String text = TAG.matcher(html).replaceAll(" ");
        String collapsed = WS.matcher(text).replaceAll(" ").trim();
        int max = 500;
        return collapsed.length() > max ? collapsed.substring(0, max) : collapsed;
    }
}
