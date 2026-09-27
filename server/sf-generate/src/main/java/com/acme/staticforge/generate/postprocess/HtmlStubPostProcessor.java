package com.acme.staticforge.generate.postprocess;

import com.acme.staticforge.channel.ChannelOutputSettings;
import com.acme.staticforge.generate.RedirectFormat;
import com.acme.staticforge.generate.pipeline.OutputFile;
import com.acme.staticforge.generate.stage.PostProcessContext;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import org.springframework.stereotype.Service;

/**
 * Writes an HTML stub at the old path of every redirect the build emits (M30.5.1, epic decision 18) — the format that
 * works on any static host and in a ZIP opened locally, and the default. A stub sends the visitor on at once (meta
 * refresh, with a script fallback that keeps the fragment), tells crawlers where the page lives now (canonical,
 * {@code noindex}) and shows a link for everyone else:
 *
 * <pre>{@code
 * <!doctype html><html><head><meta charset="utf-8"><meta name="robots" content="noindex">
 * <meta http-equiv="refresh" content="0; url=REL"><link rel="canonical" href="ABS_OR_REL">
 * <script>location.replace("REL" + location.hash)</script><title>Moved</title></head>
 * <body><a href="REL">ABS_OR_REL</a></body></html>
 * }</pre>
 *
 * {@code REL} is the target relative to the stub's own path; the canonical link is absolute under the target's
 * {@code baseUrl} when it has one. A target with its own fragment isn't given the visitor's.
 *
 * <p>Stubs are site files: the last step of the chain, after the sitemap and the search index, which list pages only.
 * A redirect whose source is a file the build already has is never written over it (such a redirect is shadowed before
 * it gets here); of two redirects with one source path (different channels) the first in order wins.
 */
@Service
public final class HtmlStubPostProcessor implements PostProcessor {

    @Override
    public List<OutputFile> process(PostProcessContext ctx, List<OutputFile> files) {
        if (!ctx.writes(RedirectFormat.HTML_STUB) || ctx.redirects().isEmpty()) {
            return files;
        }
        Set<String> taken = new HashSet<>();
        files.forEach(file -> taken.add(file.path()));
        List<OutputFile> result = new ArrayList<>(files.size() + ctx.redirects().size());
        result.addAll(files);
        for (Redirect redirect : ctx.redirects()) {
            if (taken.add(redirect.from())) {
                result.add(new OutputFile(redirect.from(), stub(ctx, redirect).getBytes(StandardCharsets.UTF_8)));
            }
        }
        return result;
    }

    /** The stub page of {@code redirect}. */
    static String stub(PostProcessContext ctx, Redirect redirect) {
        ChannelOutputSettings settings = ctx.settingsFor(redirect.channel());
        String relative = RedirectLinks.relative(redirect.from(), redirect.to(), settings);
        String absolute = RedirectLinks.absolute(ctx.baseUrl(), redirect.to(), settings);
        String canonical = absolute == null ? relative : absolute;
        String rel = RedirectLinks.html(relative);
        String script = RedirectLinks.hasFragment(redirect.to())
                ? "location.replace(" + RedirectLinks.jsString(relative) + ")"
                : "location.replace(" + RedirectLinks.jsString(relative) + " + location.hash)";
        return "<!doctype html><html><head><meta charset=\"utf-8\"><meta name=\"robots\" content=\"noindex\">"
                + "<meta http-equiv=\"refresh\" content=\"0; url=" + rel + "\">"
                + "<link rel=\"canonical\" href=\"" + RedirectLinks.html(canonical) + "\">"
                + "<script>" + script + "</script>"
                + "<title>Moved</title></head>"
                + "<body><a href=\"" + rel + "\">" + RedirectLinks.html(canonical) + "</a></body></html>\n";
    }
}
