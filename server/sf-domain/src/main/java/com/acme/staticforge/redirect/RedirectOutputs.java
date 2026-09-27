package com.acme.staticforge.redirect;

import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;

/**
 * The outputs of one build as redirects see them (M30.4.1): which paths are live, and where each page output is. Built
 * from a published build's manifest (the registry view, {@code for-asset}) or from a new build's outputs (detection
 * and emission, M30.4.2) — the build module adapts its manifest type to this one.
 *
 * <p>Live paths are the files a redirect's source path would collide with: page and media outputs. Site files
 * (sitemap, robots, search index, the redirect files themselves) are not live paths — otherwise the stubs a build
 * wrote for its redirects would shadow those same redirects in the next build.
 */
public final class RedirectOutputs {

    /** The key of a page output: page {@code pageNumber} (1-based) of {@code asset} in a channel and locale. */
    public record PageKey(UUID asset, String channel, String locale, int pageNumber) {

        public PageKey {
            locale = locale == null ? "" : locale;
        }
    }

    /** A page output: where it is and what it is. */
    public record PageOutput(PageKey key, String path) {}

    /** No outputs: nothing is live and no page resolves. */
    public static final RedirectOutputs EMPTY = builder().build();

    private final Set<String> livePaths;
    private final Map<PageKey, String> pagePaths;
    private final Map<UUID, List<PageOutput>> pagesByAsset;

    private RedirectOutputs(Set<String> livePaths, Map<PageKey, String> pagePaths, Map<UUID, List<PageOutput>> pagesByAsset) {
        this.livePaths = livePaths;
        this.pagePaths = pagePaths;
        this.pagesByAsset = pagesByAsset;
    }

    public static Builder builder() {
        return new Builder();
    }

    /** Whether a page or media file of the build lives at {@code path}. */
    public boolean isLive(String path) {
        return livePaths.contains(path);
    }

    /** The output path of page {@code pageNumber} of {@code asset} in {@code channel} and {@code locale}. */
    public Optional<String> pagePath(UUID asset, String channel, String locale, int pageNumber) {
        return Optional.ofNullable(pagePaths.get(new PageKey(asset, channel, locale, pageNumber)));
    }

    /** Every page output of {@code asset}: each channel, locale and page number; empty when it has none. */
    public List<PageOutput> pagesOf(UUID asset) {
        return pagesByAsset.getOrDefault(asset, List.of());
    }

    /** Collects the outputs of a build. */
    public static final class Builder {

        private final Set<String> livePaths = new HashSet<>();
        private final Map<PageKey, String> pagePaths = new HashMap<>();
        private final Map<UUID, List<PageOutput>> pagesByAsset = new HashMap<>();

        private Builder() {}

        /**
         * A page output. {@code locale} is {@code null} or empty in a project without locales; {@code pageNumber} is
         * {@code null} for an output that isn't a paginated page's (page 1).
         */
        public Builder page(String path, UUID asset, String channel, String locale, Integer pageNumber) {
            PageKey key = new PageKey(asset, channel, locale, pageNumber == null ? 1 : pageNumber);
            livePaths.add(path);
            if (pagePaths.putIfAbsent(key, path) == null) {
                pagesByAsset.computeIfAbsent(asset, a -> new ArrayList<>()).add(new PageOutput(key, path));
            }
            return this;
        }

        /** A media output (or any other file a redirect must not overwrite). */
        public Builder file(String path) {
            livePaths.add(path);
            return this;
        }

        public RedirectOutputs build() {
            Map<UUID, List<PageOutput>> pages = new HashMap<>();
            pagesByAsset.forEach((asset, outputs) -> pages.put(asset, List.copyOf(outputs)));
            return new RedirectOutputs(
                    Collections.unmodifiableSet(new HashSet<>(livePaths)), Map.copyOf(pagePaths), Map.copyOf(pages));
        }
    }
}
