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
            node.put("title", page.title());
            node.put("text", html == null ? "" : extractText(html.bytes()));
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
