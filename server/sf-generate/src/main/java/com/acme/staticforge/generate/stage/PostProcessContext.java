package com.acme.staticforge.generate.stage;

import com.acme.staticforge.channel.ChannelOutputSettings;
import com.acme.staticforge.generate.RedirectFormat;
import com.acme.staticforge.generate.postprocess.Redirect;
import com.acme.staticforge.generate.postprocess.SitePage;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Immutable inputs to the post-processing stage (spec §18.2 POST). Constructed by the orchestrator
 * after the render stage and passed to {@link PostProcessStage}.
 *
 * <p>{@code minify} enables the conservative HTML whitespace collapse; {@code disallow} are robots.txt
 * {@code Disallow} paths.
 *
 * <p>{@code redirects} are the redirects the build emits (M30.4.2), written in the target's {@code redirectFormats}
 * (M30.5.1); {@code channelSettings} are the output settings of their channels (pretty URLs, index file name), read
 * from the run's pinned settings.
 *
 * <p>{@code pages} is every page output of the site, rendered by this run or not (M22.4.1). A page carried forward from
 * the base build has no file among the processed ones; {@code carriedText} holds its search index text from the base
 * build, keyed by output path.
 *
 * <p>{@code defaultLocale} is the project's default language (M24.3.2), {@code null} in a project
 * without locales; the sitemap points {@code hreflang="x-default"} at it.
 */
public record PostProcessContext(
        long projectId,
        String projectKey,
        String baseUrl,
        List<String> channels,
        List<SitePage> pages,
        boolean minify,
        List<Redirect> redirects,
        List<String> disallow,
        Map<String, String> carriedText,
        String defaultLocale,
        Set<RedirectFormat> redirectFormats,
        Map<String, ChannelOutputSettings> channelSettings) {

    /** A target writing the default redirect formats; channel settings are the defaults. */
    public PostProcessContext(
            long projectId,
            String projectKey,
            String baseUrl,
            List<String> channels,
            List<SitePage> pages,
            boolean minify,
            List<Redirect> redirects,
            List<String> disallow,
            Map<String, String> carriedText,
            String defaultLocale) {
        this(projectId, projectKey, baseUrl, channels, pages, minify, redirects, disallow, carriedText, defaultLocale,
                RedirectFormat.DEFAULT, Map.of());
    }

    /** A project without locales. */
    public PostProcessContext(
            long projectId,
            String projectKey,
            String baseUrl,
            List<String> channels,
            List<SitePage> pages,
            boolean minify,
            List<Redirect> redirects,
            List<String> disallow,
            Map<String, String> carriedText) {
        this(projectId, projectKey, baseUrl, channels, pages, minify, redirects, disallow, carriedText, null);
    }

    public PostProcessContext {
        projectKey = projectKey == null ? "" : projectKey;
        baseUrl = baseUrl == null ? "" : baseUrl;
        channels = channels == null ? List.of() : List.copyOf(channels);
        pages = pages == null ? List.of() : List.copyOf(pages);
        redirects = redirects == null ? List.of() : List.copyOf(redirects);
        disallow = disallow == null ? List.of() : List.copyOf(disallow);
        carriedText = carriedText == null ? Map.of() : Map.copyOf(carriedText);
        redirectFormats = redirectFormats == null ? Set.of() : Set.copyOf(redirectFormats);
        channelSettings = channelSettings == null ? Map.of() : Map.copyOf(channelSettings);
    }

    /** Whether the target writes redirects in {@code format}. */
    public boolean writes(RedirectFormat format) {
        return redirectFormats.contains(format);
    }

    /** The output settings of {@code channel}: the run's, or the defaults of a channel without settings. */
    public ChannelOutputSettings settingsFor(String channel) {
        ChannelOutputSettings settings = channelSettings.get(channel);
        return settings == null ? ChannelOutputSettings.defaults(channel) : settings;
    }

    /** Minimal constructor for the common case (no minify, redirects, or disallow rules). */
    public PostProcessContext(
            long projectId,
            String projectKey,
            String baseUrl,
            List<String> channels,
            List<SitePage> pages) {
        this(projectId, projectKey, baseUrl, channels, pages, false, List.of(), List.of(), Map.of());
    }

    /** The common case for a run that carries pages forward from a base build. */
    public PostProcessContext(
            long projectId,
            String projectKey,
            String baseUrl,
            List<String> channels,
            List<SitePage> pages,
            Map<String, String> carriedText) {
        this(projectId, projectKey, baseUrl, channels, pages, false, List.of(), List.of(), carriedText);
    }
}
