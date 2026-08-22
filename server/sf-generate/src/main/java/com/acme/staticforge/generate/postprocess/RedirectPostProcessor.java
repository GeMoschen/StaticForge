package com.acme.staticforge.generate.postprocess;

import com.acme.staticforge.generate.pipeline.OutputFile;
import com.acme.staticforge.generate.stage.PostProcessContext;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.ArrayList;
import java.util.List;
import org.springframework.stereotype.Service;

/**
 * Emits {@code redirects.json} (spec §18.2 POST) from the context's redirect map. A no-op (empty
 * map) for M4, so it emits nothing when there are no redirects.
 */
@Service
public final class RedirectPostProcessor implements PostProcessor {

    @Override
    public List<OutputFile> process(PostProcessContext ctx, List<OutputFile> files) {
        if (ctx.redirects().isEmpty()) {
            return files;
        }
        ArrayNode arr = PostProcessSupport.json.createArrayNode();
        for (Redirect r : ctx.redirects()) {
            ObjectNode node = PostProcessSupport.json.createObjectNode();
            node.put("from", r.from());
            node.put("to", r.to());
            arr.add(node);
        }
        List<OutputFile> result = new ArrayList<>(files.size() + 1);
        result.addAll(files);
        result.add(new OutputFile("redirects.json", PostProcessSupport.jsonBytes(arr)));
        return result;
    }
}
