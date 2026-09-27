package com.acme.staticforge.generate.quality;

import com.acme.staticforge.channel.ChannelOutputSettings;
import com.acme.staticforge.generate.GenerationProperties;
import com.acme.staticforge.generate.pipeline.RenderedFile;
import com.acme.staticforge.generate.pipeline.RunAbortedException;
import com.acme.staticforge.generate.pipeline.RunCheckpoint;
import com.acme.staticforge.generate.plan.PlanEntry;
import com.acme.staticforge.generate.render.MediaOutputs;
import com.acme.staticforge.generate.snapshot.Snapshot;
import com.acme.staticforge.generate.snapshot.SnapshotAsset;
import com.acme.staticforge.generate.target.BuildManifest;
import com.acme.staticforge.project.LocaleConfig;
import com.acme.staticforge.template.diagnostic.Diagnostic;
import io.micrometer.core.instrument.MeterRegistry;
import io.micrometer.core.instrument.Timer;
import java.util.ArrayList;
import java.util.Collection;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeSet;
import java.util.UUID;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.Semaphore;
import java.util.function.Function;
import java.util.stream.Collectors;
import org.springframework.stereotype.Service;

/**
 * The {@code CHECK} stage of a build (M30.1.3, epic decisions 5–8, 11): between ASSETS and POST it parses every HTML
 * output the run rendered — once, on virtual threads bounded by {@code sf.generate.parallelism} — runs the enabled page
 * rules on it, then builds the {@link SiteIndex} over the whole site (new outputs, carried outputs with their facts from
 * the base build's sidecar, media and site files) and runs the site rules in two phases around the hold-back.
 *
 * <p><b>Hold-back.</b> An {@code ERROR} finding on an output this run rendered holds back every output of that page in
 * that channel and language (all page numbers, carried ones included) with one {@code SF-GEN-0125} file error per
 * page. Findings on carried outputs are reported but never hold anything back.
 *
 * <p>Checks only read: no output byte changes. Findings are returned, not stored — the run stores them with its status.
 */
@Service
public class QualityCheckStage {

    private final PageRuleRunner pageRules;
    private final SiteRuleRunner siteRules;
    private final GenerationProperties properties;
    private final MeterRegistry meterRegistry;

    public QualityCheckStage(
            PageRuleRunner pageRules, SiteRuleRunner siteRules, GenerationProperties properties, MeterRegistry meterRegistry) {
        this.pageRules = pageRules;
        this.siteRules = siteRules;
        this.properties = properties;
        this.meterRegistry = meterRegistry;
    }

    /**
     * What the stage checks.
     *
     * @param config the project's effective rule configuration
     * @param baseUrl the target's {@code baseUrl}; {@code ""} for none
     * @param channels the output settings per channel
     * @param snapshot names assets in messages
     * @param entries the run's plan entries (which page, channel, language and page number each path is)
     * @param rendered the page files the run rendered
     * @param notRendered paths of page outputs the run planned but didn't render (held back before the checks)
     * @param carriedPages the base build's page outputs the run keeps
     * @param media every media output of the build: written by the run and carried
     * @param siteFiles the site files post-processing will write ({@code sitemap.xml}, …)
     * @param baseSidecar the base build's sidecar; {@code null} without a base build or when it has none
     * @param checkpoint called before each output is checked: a cancelled run stops here
     */
    public record CheckInput(
            EffectiveQualityConfig config,
            String baseUrl,
            LocaleConfig locales,
            Function<String, ChannelOutputSettings> channels,
            Snapshot snapshot,
            List<PlanEntry> entries,
            List<RenderedFile> rendered,
            Set<String> notRendered,
            List<BuildManifest.Output> carriedPages,
            Map<String, MediaOutputs.Key> media,
            Set<String> siteFiles,
            QualitySidecar baseSidecar,
            RunCheckpoint checkpoint) {}

    /**
     * What the stage found and decided.
     *
     * @param findings every finding to store: page rules (new and carried), then both site phases
     * @param heldBack the page outputs the checks hold back (rendered and carried)
     * @param pageErrors one {@code SF-GEN-0125} per held-back page, channel and language
     * @param sidecar the new build's sidecar (facts and page-local findings of every checked output it publishes)
     * @param outputs every output of the build before the hold-back, by path
     * @param checkedOutputs how many outputs were checked (parsed this run or carried with facts)
     */
    public record CheckResult(
            List<Finding> findings,
            Set<String> heldBack,
            List<Diagnostic> pageErrors,
            QualitySidecar sidecar,
            Map<String, IndexedOutput> outputs,
            int checkedOutputs) {

        /**
         * The outputs the build publishes after the hold-back, by path — pages (rendered and carried), media and site
         * files. The seam for redirect detection (M30.4.2), which compares them with the target's current build.
         */
        public Map<String, IndexedOutput> finalOutputs() {
            Map<String, IndexedOutput> remaining = new LinkedHashMap<>(outputs);
            remaining.keySet().removeAll(heldBack);
            return remaining;
        }

        /** {@code rendered} without the held-back files: what the run publishes. */
        public List<RenderedFile> published(List<RenderedFile> rendered) {
            return rendered.stream().filter(file -> !heldBack.contains(file.outputPath())).toList();
        }

        public long errorCount() {
            return findings.stream().filter(Finding::isError).count();
        }

        public long warningCount() {
            return findings.size() - errorCount();
        }
    }

    /** The page a hold-back decides about: one page in one channel and language. */
    private record PageKey(UUID asset, String channel, String locale) {

        static PageKey of(OutputKey key) {
            return new PageKey(key.asset(), key.channel(), key.locale());
        }
    }

    /** Checks one build. */
    public CheckResult check(CheckInput input) {
        Timer.Sample sample = Timer.start(meterRegistry);
        EffectiveQualityConfig config = input.config();

        Map<String, IndexedOutput> outputs = new LinkedHashMap<>();
        Map<String, PlanEntry> entries = new HashMap<>();
        input.entries().forEach(entry -> entries.put(entry.outputPath(), entry));
        List<RenderedFile> toCheck = new ArrayList<>();
        Map<String, List<ReferenceEvent>> events = new HashMap<>();
        for (RenderedFile file : input.rendered()) {
            PlanEntry entry = entries.get(file.outputPath());
            if (entry == null) {
                continue;
            }
            OutputKey key = new OutputKey(file.outputPath(), entry.pageUuid(), entry.channel(), entry.locale(),
                    entry.pagination() == null ? null : entry.pageNumber());
            outputs.put(key.path(), new IndexedOutput(key, BuildManifest.Kind.PAGE, false));
            if (!file.references().isEmpty()) {
                events.put(key.path(), located(file.references(), input.snapshot(), entry));
            }
            toCheck.add(file);
        }
        for (BuildManifest.Output carried : input.carriedPages()) {
            outputs.putIfAbsent(carried.path(), new IndexedOutput(OutputKey.of(carried), BuildManifest.Kind.PAGE, true));
        }
        input.media().forEach((path, key) -> outputs.putIfAbsent(path, new IndexedOutput(
                new OutputKey(path, key.media(), null, key.locale(), null), BuildManifest.Kind.MEDIA, false)));
        for (String path : input.siteFiles()) {
            outputs.putIfAbsent(path, new IndexedOutput(
                    new OutputKey(path, null, null, null, null), BuildManifest.Kind.SITE, false));
        }

        CheckEnvironment environment = new CheckEnvironment(
                input.baseUrl(), input.locales(), outputs, input.channels(), labels(input.snapshot()), events);

        // Page rules: new HTML outputs are parsed here, carried ones bring facts and findings from the base sidecar.
        Map<String, HtmlFacts> facts = new LinkedHashMap<>();
        Map<String, List<Finding>> pageFindings = new LinkedHashMap<>();
        checkRendered(toCheck, outputs, config, environment, input.checkpoint(), facts, pageFindings);
        carryForward(input, outputs, environment, config, facts, pageFindings, events);
        int checked = pageFindings.size();

        List<Finding> findings = new ArrayList<>();
        pageFindings.values().forEach(findings::addAll);
        SiteIndex site = new SiteIndex(environment, facts, input.notRendered(), events, Set.of());
        findings.addAll(siteRules.run(site, config, false));

        // Hold-back: an ERROR on an output this run rendered holds back every output of its page, channel and language.
        Map<PageKey, Set<String>> codesByPage = new LinkedHashMap<>();
        for (Finding finding : findings) {
            IndexedOutput output = outputs.get(finding.output().path());
            if (finding.isError() && output != null && !output.carried() && output.kind() == BuildManifest.Kind.PAGE) {
                codesByPage.computeIfAbsent(PageKey.of(output.key()), k -> new TreeSet<>()).add(finding.code());
            }
        }
        Set<String> held = new LinkedHashSet<>();
        for (IndexedOutput output : outputs.values()) {
            if (output.kind() == BuildManifest.Kind.PAGE && codesByPage.containsKey(PageKey.of(output.key()))) {
                held.add(output.path());
            }
        }
        List<Diagnostic> pageErrors = new ArrayList<>();
        codesByPage.forEach((page, codes) -> pageErrors.add(heldBackError(input.snapshot(), page, codes)));

        Map<String, IndexedOutput> published = new LinkedHashMap<>(outputs);
        published.keySet().removeAll(held);
        Map<String, HtmlFacts> publishedFacts = new LinkedHashMap<>(facts);
        publishedFacts.keySet().removeAll(held);
        Set<String> heldBack = new LinkedHashSet<>(input.notRendered());
        heldBack.addAll(held);
        CheckEnvironment afterHoldBack = new CheckEnvironment(
                input.baseUrl(), input.locales(), published, input.channels(), labels(input.snapshot()), events);
        findings.addAll(siteRules.run(
                new SiteIndex(afterHoldBack, publishedFacts, heldBack, events, Set.of()), config, true));

        QualitySidecar sidecar = sidecar(config, publishedFacts, pageFindings, events, held);
        sample.stop(meterRegistry.timer("sf.quality.check.duration"));
        count(findings);
        return new CheckResult(List.copyOf(findings), Set.copyOf(held), pageErrors, sidecar, outputs, checked);
    }

    /** Parses and page-checks the rendered HTML outputs in parallel; results keep the rendered order. */
    private void checkRendered(
            List<RenderedFile> files,
            Map<String, IndexedOutput> outputs,
            EffectiveQualityConfig config,
            CheckEnvironment environment,
            RunCheckpoint checkpoint,
            Map<String, HtmlFacts> facts,
            Map<String, List<Finding>> findings) {
        List<RenderedFile> html = files.stream()
                .filter(file -> environment.isHtmlChannel(outputs.get(file.outputPath()).key().channel()))
                .toList();
        if (html.isEmpty()) {
            return;
        }
        Semaphore permits = new Semaphore(Math.max(1, properties.getParallelism()));
        try (ExecutorService executor = Executors.newVirtualThreadPerTaskExecutor()) {
            List<Future<PageRuleRunner.PageCheck>> futures = new ArrayList<>(html.size());
            for (RenderedFile file : html) {
                OutputKey key = outputs.get(file.outputPath()).key();
                futures.add(executor.submit(() -> {
                    permits.acquire();
                    try {
                        checkpoint.check();
                        return pageRules.check(key, file.bytes(), config, environment);
                    } finally {
                        permits.release();
                    }
                }));
            }
            for (int i = 0; i < html.size(); i++) {
                String path = html.get(i).outputPath();
                PageRuleRunner.PageCheck check;
                try {
                    check = futures.get(i).get();
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                    futures.forEach(future -> future.cancel(true));
                    throw new IllegalStateException("Interrupted while checking output", e);
                } catch (ExecutionException e) {
                    if (e.getCause() instanceof RunAbortedException aborted) {
                        futures.forEach(future -> future.cancel(true));
                        throw aborted;
                    }
                    check = new PageRuleRunner.PageCheck(null, null, pageRules.notChecked(
                            outputs.get(path).key(), config, "the check failed (" + e.getCause() + ")."));
                }
                if (check.facts() != null) {
                    facts.put(path, check.facts());
                }
                findings.put(path, check.findings());
            }
        }
    }

    /**
     * Carried outputs take their facts, page-local findings and reference events from the base build's sidecar (epic
     * decision 7): the findings under the current configuration (a rule switched off drops them, the severity is the
     * current one), and marked as carried; the events for the site rules, which run fresh over them.
     */
    private static void carryForward(
            CheckInput input,
            Map<String, IndexedOutput> outputs,
            CheckEnvironment environment,
            EffectiveQualityConfig config,
            Map<String, HtmlFacts> facts,
            Map<String, List<Finding>> findings,
            Map<String, List<ReferenceEvent>> events) {
        if (input.baseSidecar() == null) {
            return;
        }
        for (IndexedOutput output : outputs.values()) {
            if (!output.carried() || !environment.isHtmlChannel(output.key().channel())) {
                continue;
            }
            QualitySidecar.Entry entry = input.baseSidecar().entry(output.path()).orElse(null);
            if (entry == null) {
                continue;
            }
            if (entry.facts() != null) {
                facts.put(output.path(), entry.facts());
            }
            if (!entry.references().isEmpty()) {
                events.put(output.path(), entry.references());
            }
            List<Finding> carried = new ArrayList<>();
            for (QualitySidecar.PageFinding finding : entry.findings()) {
                config.registry().find(finding.code())
                        .filter(config::enabled)
                        .ifPresent(rule -> carried.add(finding.toFinding(output.key()).withSeverity(config.severity(rule))));
            }
            findings.put(output.path(), carried);
        }
    }

    private static QualitySidecar sidecar(
            EffectiveQualityConfig config,
            Map<String, HtmlFacts> publishedFacts,
            Map<String, List<Finding>> pageFindings,
            Map<String, List<ReferenceEvent>> events,
            Set<String> held) {
        Map<String, QualitySidecar.Entry> entries = new LinkedHashMap<>();
        pageFindings.forEach((path, findings) -> {
            if (!held.contains(path)) {
                entries.put(path, new QualitySidecar.Entry(
                        publishedFacts.get(path),
                        findings.stream().map(QualitySidecar.PageFinding::of).toList(),
                        events.getOrDefault(path, List.of())));
            }
        });
        return new QualitySidecar(QualitySidecar.VERSION, config.fingerprint(), entries);
    }

    /**
     * {@code references} of the output {@code entry} rendered, each located at the editor path of the rendering page's
     * content that holds it (when the page's content holds it at all, not a template).
     */
    private static List<ReferenceEvent> located(List<ReferenceEvent> references, Snapshot snapshot, PlanEntry entry) {
        SnapshotAsset page = entry.pageUuid() == null ? null : snapshot.asset(entry.pageUuid(), entry.locale());
        Map<UUID, String> paths = EditorPaths.of(page == null ? null : page.payload());
        return references.stream()
                .map(event -> paths.containsKey(event.target()) ? event.withEditorPath(paths.get(event.target())) : event)
                .toList();
    }

    private static Diagnostic heldBackError(Snapshot snapshot, PageKey page, Collection<String> codes) {
        SnapshotAsset asset = page.asset() == null ? null : snapshot.asset(page.asset(), page.locale());
        String name = asset != null && asset.uid() != null ? asset.uid() : String.valueOf(page.asset());
        String where = page.channel() + (page.locale() == null ? "" : ", " + page.locale());
        return Diagnostic.error(
                QualityCodes.GEN_QUALITY_CHECK_FAILED,
                "Quality check failed for page '" + name + "' (" + where + "): " + String.join(", ", codes),
                0,
                0);
    }

    private static Function<UUID, AssetLabel> labels(Snapshot snapshot) {
        return uuid -> {
            SnapshotAsset asset = snapshot.assetByUuid(uuid);
            return asset == null ? null : new AssetLabel(uuid, asset.uid(), asset.displayName(), asset.type().name());
        };
    }

    private void count(List<Finding> findings) {
        Map<List<String>, Long> counts = findings.stream().collect(Collectors.groupingBy(
                finding -> List.of(finding.severity().name(), finding.category().key()), Collectors.counting()));
        counts.forEach((tags, n) -> meterRegistry
                .counter("sf.quality.findings", "severity", tags.get(0), "category", tags.get(1))
                .increment(n));
    }
}
