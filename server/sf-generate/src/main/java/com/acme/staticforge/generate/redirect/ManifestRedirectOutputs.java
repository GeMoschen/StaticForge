package com.acme.staticforge.generate.redirect;

import com.acme.staticforge.generate.target.BuildManifest;
import com.acme.staticforge.redirect.RedirectOutputs;
import java.util.Collection;

/**
 * Adapts build outputs to what redirects see of them ({@link RedirectOutputs}, M30.4.1): page outputs are keyed by
 * asset, channel, locale and page number; media outputs are live paths; site files (sitemap, robots, search index,
 * the redirect files) are neither.
 */
public final class ManifestRedirectOutputs {

    private ManifestRedirectOutputs() {}

    /** The outputs of a published build. */
    public static RedirectOutputs of(BuildManifest manifest) {
        return of(manifest.outputs());
    }

    /** The given outputs — a manifest's, or a new build's before it is written (M30.4.2). */
    public static RedirectOutputs of(Collection<BuildManifest.Output> outputs) {
        RedirectOutputs.Builder builder = RedirectOutputs.builder();
        for (BuildManifest.Output output : outputs) {
            switch (output.kind()) {
                case PAGE -> {
                    if (output.asset() != null && output.channel() != null) {
                        builder.page(output.path(), output.asset(), output.channel(), output.locale(), output.pageNumber());
                    } else {
                        builder.file(output.path());
                    }
                }
                case MEDIA -> builder.file(output.path());
                case SITE -> {
                    // not a live path: see RedirectOutputs
                }
            }
        }
        return builder.build();
    }
}
