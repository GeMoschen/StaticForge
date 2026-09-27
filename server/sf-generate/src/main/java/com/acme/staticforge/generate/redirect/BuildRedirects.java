package com.acme.staticforge.generate.redirect;

import com.acme.staticforge.generate.postprocess.Redirect;
import com.acme.staticforge.generate.quality.IndexedOutput;
import com.acme.staticforge.generate.quality.OutputKey;
import com.acme.staticforge.generate.target.BuildManifest;
import com.acme.staticforge.redirect.RedirectEntry;
import com.acme.staticforge.redirect.RedirectKind;
import com.acme.staticforge.redirect.RedirectOutputs;
import com.acme.staticforge.redirect.RedirectResolver;
import com.acme.staticforge.redirect.RedirectRule;
import com.acme.staticforge.redirect.RedirectService.AutoCandidate;
import com.acme.staticforge.redirect.ResolvedRedirect;
import java.util.ArrayList;
import java.util.Collection;
import java.util.Comparator;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * The redirects of one build (M30.4.2, epic decisions 15, 16): what moved since the build the target serves, and which
 * redirects the build emits.
 *
 * <p><b>Detection.</b> The target's <em>current</em> build — the one visitors see, also after a promote or rollback, and
 * also for a FULL run, which has no base — is indexed by page output key (asset, channel, locale, page number). Every
 * page output the run rendered and publishes whose key is there with a different path is a candidate {@code AUTO}
 * redirect from the old path to the page. Outputs the run doesn't have add nothing (removed pages, fewer paginated
 * pages), and carried outputs keep their paths by definition. A current build written before manifests recorded
 * languages can't be compared in a localized project: its page outputs are skipped (logged once).
 *
 * <p><b>The build's set.</b> The stored redirects plus the candidates — a candidate replaces the {@code AUTO} entry of its
 * source path and never a {@code MANUAL} one — resolved against the build's own outputs ({@link RedirectResolver}); only
 * {@code ACTIVE} ones are emitted, each to its target's path in the same channel and locale (a fixed target as stored).
 *
 * <p>Immutable and pure apart from that one log line; {@link #forOutputs} can be asked for several output sets (before
 * and after the hold-back of the quality checks).
 */
public final class BuildRedirects {

    private static final Logger LOG = LoggerFactory.getLogger(BuildRedirects.class);

    private static final Comparator<AutoCandidate> CANDIDATE_ORDER = Comparator.comparing(AutoCandidate::channel)
            .thenComparing(AutoCandidate::locale)
            .thenComparing(AutoCandidate::fromPath);

    /** A stored redirect: how the resolver reads it, and who owns it. */
    private record Stored(RedirectRule rule, RedirectKind kind) {}

    private record SourceKey(String channel, String locale, String path) {

        static SourceKey of(RedirectRule rule) {
            return new SourceKey(rule.channel(), rule.locale(), rule.fromPath());
        }
    }

    private final Map<RedirectOutputs.PageKey, String> previous;
    private final Map<SourceKey, Stored> stored;

    private BuildRedirects(Map<RedirectOutputs.PageKey, String> previous, Map<SourceKey, Stored> stored) {
        this.previous = previous;
        this.stored = stored;
    }

    /**
     * The redirects of a build.
     *
     * @param current the manifest of the build the target serves now; {@code null} when it has none (nothing is detected)
     * @param persisted the project's redirect registry
     * @param localized whether the project has languages
     */
    public static BuildRedirects of(BuildManifest current, List<RedirectEntry> persisted, boolean localized) {
        Map<SourceKey, Stored> stored = new LinkedHashMap<>();
        for (RedirectEntry entry : persisted) {
            RedirectRule rule = entry.rule();
            stored.putIfAbsent(SourceKey.of(rule), new Stored(rule, entry.getKind()));
        }
        return new BuildRedirects(previousPages(current, localized), stored);
    }

    /** The page outputs of the current build, by key; outputs whose language the manifest didn't record are left out. */
    private static Map<RedirectOutputs.PageKey, String> previousPages(BuildManifest current, boolean localized) {
        if (current == null) {
            return Map.of();
        }
        Map<RedirectOutputs.PageKey, String> pages = new HashMap<>();
        int withoutLocale = 0;
        for (BuildManifest.Output output : current.outputs()) {
            if (output.kind() != BuildManifest.Kind.PAGE || output.asset() == null || output.channel() == null) {
                continue;
            }
            if (localized && output.locale() == null) {
                withoutLocale++;
                continue;
            }
            pages.putIfAbsent(
                    new RedirectOutputs.PageKey(output.asset(), output.channel(), output.locale(), output.number()),
                    output.path());
        }
        if (withoutLocale > 0) {
            LOG.info("Build {} records no language for {} page output(s) (written before manifests had locales); "
                    + "no redirects are detected for them", current.runId(), withoutLocale);
        }
        return Map.copyOf(pages);
    }

    /**
     * The redirects of a build with {@code outputs} — every output it publishes (pages rendered and carried, media and
     * the site files post-processing writes, which a redirect never replaces); only page outputs the run rendered
     * ({@link IndexedOutput#carried()} false) are compared.
     */
    public Result forOutputs(Collection<IndexedOutput> outputs) {
        List<AutoCandidate> candidates = new ArrayList<>();
        RedirectOutputs.Builder live = RedirectOutputs.builder();
        for (IndexedOutput output : outputs) {
            OutputKey key = output.key();
            switch (output.kind()) {
                case PAGE -> {
                    if (key.asset() == null || key.channel() == null) {
                        live.file(key.path());
                        continue;
                    }
                    live.page(key.path(), key.asset(), key.channel(), key.locale(), key.pageNumber());
                    if (!output.carried()) {
                        candidate(key).ifPresent(candidates::add);
                    }
                }
                // The build's own site files (sitemap, search index, the redirect files) are never written over; a
                // published build's site files, stubs among them, are not live (RedirectOutputs) — none are here.
                case MEDIA, SITE -> live.file(key.path());
            }
        }
        candidates.sort(CANDIDATE_ORDER);
        return resolve(candidates, live.build());
    }

    /** The candidates of a build that would render {@code rendered} (a dry run): nothing is resolved. */
    public List<AutoCandidate> candidates(Collection<OutputKey> rendered) {
        List<AutoCandidate> candidates = new ArrayList<>();
        for (OutputKey key : rendered) {
            if (key.asset() != null && key.channel() != null) {
                candidate(key).ifPresent(candidates::add);
            }
        }
        candidates.sort(CANDIDATE_ORDER);
        return List.copyOf(candidates);
    }

    /**
     * The candidate of one rendered page output: its key is in the current build at another path, and no manual
     * redirect owns that path (it would keep it anyway).
     */
    private Optional<AutoCandidate> candidate(OutputKey key) {
        RedirectOutputs.PageKey pageKey =
                new RedirectOutputs.PageKey(key.asset(), key.channel(), key.locale(), key.number());
        String before = previous.get(pageKey);
        if (before == null || before.equals(key.path())) {
            return Optional.empty();
        }
        Stored owner = stored.get(new SourceKey(pageKey.channel(), pageKey.locale(), before));
        if (owner != null && owner.kind() == RedirectKind.MANUAL) {
            return Optional.empty();
        }
        return Optional.of(
                new AutoCandidate(pageKey.channel(), pageKey.locale(), before, pageKey.asset(), pageKey.pageNumber()));
    }

    private Result resolve(List<AutoCandidate> candidates, RedirectOutputs outputs) {
        Map<SourceKey, RedirectRule> rules = new LinkedHashMap<>();
        stored.forEach((key, entry) -> rules.put(key, entry.rule()));
        for (AutoCandidate candidate : candidates) {
            RedirectRule rule = RedirectRule.toAsset(candidate.channel(), candidate.locale(), candidate.fromPath(),
                    candidate.toAssetUuid(), candidate.toPageNumber());
            // A candidate replaces the AUTO entry of its path; candidates under a MANUAL entry were never made.
            rules.put(SourceKey.of(rule), rule);
        }
        List<ResolvedRedirect> resolved = RedirectResolver.resolve(List.copyOf(rules.values()), outputs);
        return new Result(List.copyOf(candidates), resolved);
    }

    /**
     * The redirects of one output set.
     *
     * @param candidates the new {@code AUTO} redirects the build detected, sorted by channel, locale and source path
     * @param resolved the stored redirects and the candidates, each with its state against the outputs
     */
    public record Result(List<AutoCandidate> candidates, List<ResolvedRedirect> resolved) {

        /** The redirects the build emits ({@code ACTIVE}), sorted by channel, locale and source path. */
        public List<ResolvedRedirect> active() {
            return resolved.stream()
                    .filter(ResolvedRedirect::active)
                    .sorted(Comparator.comparing((ResolvedRedirect r) -> r.rule().channel())
                            .thenComparing(r -> r.rule().locale())
                            .thenComparing(r -> r.rule().fromPath()))
                    .toList();
        }

        /** The emitted redirects as post-processing writes them. */
        public List<Redirect> redirects() {
            return active().stream()
                    .map(r -> new Redirect(r.rule().fromPath(), r.target(), r.rule().channel(), r.rule().locale()))
                    .toList();
        }

        /** The source paths of the emitted redirects. */
        public Set<String> sources() {
            Set<String> sources = new LinkedHashSet<>();
            active().forEach(r -> sources.add(r.rule().fromPath()));
            return sources;
        }
    }
}
