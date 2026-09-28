package com.acme.staticforge.generate.quality;

import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;

/**
 * Everything the site-wide rules see of one build (M30, epic decisions 3, 6, 8): every output (new and carried, pages,
 * media and site files), the {@link HtmlFacts} of every checked HTML output (new ones from this run's parse, carried
 * ones from the base build's sidecar), the page outputs held back in this build, the renderer's reference events per
 * output, and the paths an emitted redirect is served at.
 *
 * <p>Immutable. A build makes two: the first, for the rules that decide the hold-back, holds every output and, as
 * {@link #heldBack()}, the pages held back before the checks (incomplete content, render limits); the second, for the rules that run after it ({@link SiteRule#afterHoldBack()}),
 * holds only the outputs still published and every held-back page output.
 *
 * @param environment the outputs, locales, channels and asset names ({@link CheckEnvironment#outputs()} is every output)
 * @param facts the facts of every checked HTML output, by path
 * @param heldBack paths of page outputs the build planned but doesn't publish: held back for incomplete content
 *     ({@code SF-GEN-0120}), a render limit or a quality {@code ERROR} ({@code SF-GEN-0125})
 * @param referenceEvents the references the renderer could not resolve, by the path of the output that rendered them
 *     (a carried output's from the base build's sidecar)
 * @param redirectSources paths the build serves a redirect at (M30.5.1): the sources of the redirects it emits for these
 *     outputs, when its target writes a redirect format; never an output path of the build
 */
public record SiteIndex(
        CheckEnvironment environment,
        Map<String, HtmlFacts> facts,
        Set<String> heldBack,
        Map<String, List<ReferenceEvent>> referenceEvents,
        Set<String> redirectSources) {

    public SiteIndex {
        facts = facts == null ? Map.of() : Map.copyOf(facts);
        heldBack = heldBack == null ? Set.of() : Set.copyOf(heldBack);
        referenceEvents = referenceEvents == null ? Map.of() : Map.copyOf(referenceEvents);
        redirectSources = redirectSources == null ? Set.of() : Set.copyOf(redirectSources);
    }

    /** Every output of the build, by path. */
    public Map<String, IndexedOutput> outputs() {
        return environment.outputs();
    }

    /** The output at {@code path}; empty when the build has none there. */
    public Optional<IndexedOutput> output(String path) {
        return environment.output(path);
    }

    /** The facts of the HTML output at {@code path}; empty when it wasn't checked (not HTML, or not an output). */
    public Optional<HtmlFacts> factsOf(String path) {
        return Optional.ofNullable(path == null ? null : facts.get(path));
    }

    /** Whether {@code path} is a page output held back in this build. */
    public boolean isHeldBack(String path) {
        return heldBack.contains(path);
    }

    /** The unresolved references the renderer met while rendering the output at {@code path}. */
    public List<ReferenceEvent> eventsOf(String path) {
        return referenceEvents.getOrDefault(path, List.of());
    }

    /** Whether a redirect of this build is served at {@code path}. */
    public boolean isRedirectSource(String path) {
        return redirectSources.contains(path);
    }
}
