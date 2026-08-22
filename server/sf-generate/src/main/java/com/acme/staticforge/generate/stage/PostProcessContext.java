package com.acme.staticforge.generate.stage;

import com.acme.staticforge.generate.postprocess.Redirect;
import com.acme.staticforge.generate.postprocess.SitePage;
import java.util.List;

/**
 * Immutable inputs to the post-processing stage (spec §18.2 POST). Constructed by the orchestrator
 * after the render stage and passed to {@link PostProcessStage}.
 *
 * <p>{@code minify} enables the conservative HTML whitespace collapse; {@code redirects} is the
 * redirect map ({@code from}/{@code to} pairs, empty for M4); {@code disallow} are robots.txt
 * {@code Disallow} paths.
 */
public record PostProcessContext(
        long projectId,
        String projectKey,
        String baseUrl,
        List<String> channels,
        List<SitePage> pages,
        boolean minify,
        List<Redirect> redirects,
        List<String> disallow) {

    public PostProcessContext {
        projectKey = projectKey == null ? "" : projectKey;
        baseUrl = baseUrl == null ? "" : baseUrl;
        channels = channels == null ? List.of() : List.copyOf(channels);
        pages = pages == null ? List.of() : List.copyOf(pages);
        redirects = redirects == null ? List.of() : List.copyOf(redirects);
        disallow = disallow == null ? List.of() : List.copyOf(disallow);
    }

    /** Minimal constructor for the common case (no minify, redirects, or disallow rules). */
    public PostProcessContext(
            long projectId,
            String projectKey,
            String baseUrl,
            List<String> channels,
            List<SitePage> pages) {
        this(projectId, projectKey, baseUrl, channels, pages, false, List.of(), List.of());
    }
}
