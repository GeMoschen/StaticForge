package com.acme.staticforge.generate.postprocess;

import com.acme.staticforge.generate.RedirectFormat;
import com.acme.staticforge.generate.pipeline.OutputFile;
import com.acme.staticforge.generate.stage.PostProcessContext;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.ArrayList;
import java.util.List;
import org.springframework.stereotype.Service;

/**
 * Emits {@code redirects.json} (spec §18.2 POST) when the target writes the {@code JSON} redirect format (M30.5.1): one
 * entry per redirect the build emits, {@code {from, to, channel, locale, status}} — {@code from} and {@code to} are
 * output paths as the registry stores them ({@code to} may carry a query and fragment, or be an absolute URL),
 * {@code locale} is {@code ""} in a project without locales, {@code status} is always {@code 301}. Written with an empty
 * list when there is nothing to redirect, so a host reading it always finds it.
 */
@Service
public final class RedirectPostProcessor implements PostProcessor {

    /** The file name. */
    public static final String PATH = "redirects.json";

    @Override
    public List<OutputFile> process(PostProcessContext ctx, List<OutputFile> files) {
        if (!ctx.writes(RedirectFormat.JSON)) {
            return files;
        }
        ArrayNode arr = PostProcessSupport.json.createArrayNode();
        for (Redirect r : ctx.redirects()) {
            ObjectNode node = PostProcessSupport.json.createObjectNode();
            node.put("from", r.from());
            node.put("to", r.to());
            node.put("channel", r.channel());
            node.put("locale", r.locale());
            node.put("status", RedirectLinks.STATUS);
            arr.add(node);
        }
        List<OutputFile> result = new ArrayList<>(files.size() + 1);
        result.addAll(files);
        result.add(new OutputFile(PATH, PostProcessSupport.jsonBytes(arr)));
        return result;
    }
}
