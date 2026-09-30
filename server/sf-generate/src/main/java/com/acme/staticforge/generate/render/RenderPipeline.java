package com.acme.staticforge.generate.render;

import com.acme.staticforge.asset.AssetType;
import com.acme.staticforge.asset.content.ContentIssue;
import com.acme.staticforge.asset.content.ContentValidator;
import com.acme.staticforge.asset.content.LocalizationContext;
import com.acme.staticforge.asset.content.SectionTemplateLookup;
import com.acme.staticforge.asset.content.SectionTemplateLookup.SectionTemplate;
import com.acme.staticforge.asset.folder.FolderScope;
import com.acme.staticforge.asset.rules.RuleEngine;
import com.acme.staticforge.asset.rules.RuleOutcome;
import com.acme.staticforge.asset.template.CompiledTemplateCache;
import com.acme.staticforge.asset.template.TemplateCompileMemo;
import com.acme.staticforge.channel.ChannelService;
import com.acme.staticforge.common.ProblemFactory;
import com.acme.staticforge.common.SfException;
import com.acme.staticforge.generate.GenerationDiagnosticCodes;
import com.acme.staticforge.generate.GenerationProperties;
import com.acme.staticforge.generate.pipeline.RenderedFile;
import com.acme.staticforge.generate.pipeline.RunAbortedException;
import com.acme.staticforge.generate.pipeline.RunCheckpoint;
import com.acme.staticforge.generate.plan.BuildPlan;
import com.acme.staticforge.generate.plan.PlanEntry;
import com.acme.staticforge.generate.snapshot.Snapshot;
import com.acme.staticforge.generate.snapshot.SnapshotAsset;
import com.acme.staticforge.project.LocaleConfig;
import com.acme.staticforge.project.Project;
import com.acme.staticforge.project.ProjectRepository;
import com.acme.staticforge.template.cdl.CdlSources;
import com.acme.staticforge.template.content.ContentDefinition;
import com.acme.staticforge.template.content.EffectiveDefinition;
import com.acme.staticforge.template.diagnostic.Diagnostic;
import com.acme.staticforge.template.diagnostic.DiagnosticPage;
import com.acme.staticforge.template.diagnostic.Severity;
import com.acme.staticforge.template.expression.ExpressionEvaluator;
import com.acme.staticforge.template.render.RenderLimitException;
import com.acme.staticforge.template.rules.OnGeneration;
import com.acme.staticforge.template.rules.RuleScope;
import io.micrometer.core.instrument.MeterRegistry;
import io.micrometer.core.instrument.Timer;
import java.time.Duration;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.Semaphore;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;
import org.springframework.stereotype.Service;

/**
 * The render pipeline (spec §18.2 RENDER): VALIDATE all needed templates, detect output-path
 * collisions, hold back pages with incomplete content ({@code SF-GEN-0120}), then render every
 * remaining plan entry in parallel over virtual threads bounded by
 * {@link GenerationProperties#getParallelism}. A page that hits a render limit
 * ({@code SF-TPL-0130}–{@code 0135}, e.g. an include cycle) is held back the same way: it is reported
 * in {@link RenderOutcome#pageErrors()} and the rest of the plan still publishes. Reference edges are maintained on save
 * ({@code ReferenceMaterializer}), not derived from render dependencies.
 */
@Service
public class RenderPipeline {

    private static final String COLLISION_CODE = "SF-GEN-0110";

    /** A page whose output path expression has no {@code {locale}} segment in a localized project (M24.3.2). */
    private static final String NOT_LOCALE_DISTINCT_CODE = "SF-GEN-0111";

    private final GenerationProperties properties;
    private final ProjectRepository projects;
    private final ChannelService channelService;
    private final MeterRegistry meterRegistry;
    private final CompiledTemplateCache compiledTemplates;

    public RenderPipeline(
            GenerationProperties properties,
            ProjectRepository projects,
            ChannelService channelService,
            MeterRegistry meterRegistry,
            CompiledTemplateCache compiledTemplates) {
        this.properties = properties;
        this.projects = projects;
        this.channelService = channelService;
        this.meterRegistry = meterRegistry;
        this.compiledTemplates = compiledTemplates;
    }

    /**
     * Compiles every page template channel in the plan and returns the union of ERROR diagnostics
     * (empty when the plan validates cleanly). Section templates are validated transitively as
     * the renderer encounters them. Compiles go through the snapshot's build memo, so the render
     * stage of the same build reuses them.
     */
    public List<Diagnostic> validate(Snapshot snapshot, BuildPlan plan) {
        GenerationRenderer renderer = new GenerationRenderer(
                snapshot, null, "", channelService, compiledTemplates.buildMemo(snapshot.root()));
        Set<String> seen = new HashSet<>();
        List<Diagnostic> errors = new ArrayList<>();
        for (PlanEntry entry : plan.entries()) {
            Snapshot view = snapshot.in(entry.locale());
            SnapshotAsset page = view.assetByUuid(entry.pageUuid());
            if (page == null) {
                errors.add(Diagnostic.error(
                        "SF-GEN-0202", "Page missing from snapshot: " + entry.pageUuid(), 0, 0));
                continue;
            }
            SnapshotAsset template = GenerationRenderer.templateOf(view, page);
            if (template == null) {
                continue; // renders empty; not a validation error
            }
            String key = template.uuid() + ":" + entry.channel();
            if (!seen.add(key)) {
                continue;
            }
            errors.addAll(renderer.compileErrors(template, entry.channel()));
        }
        return List.copyOf(errors);
    }

    /**
     * What VALIDATE found (M33.7): the page languages held back with their {@code SF-GEN-0120}, the {@code fail}
     * errors that end the run ({@code SF-GEN-0121}), and the rule warnings and infos ({@code SF-GEN-0122}).
     */
    private record Validation(
            Map<PageLocale, Diagnostic> heldBack, List<Diagnostic> failures, List<Diagnostic> findings) {}

    /**
     * Content validation per planned page and language (spec §10.5, VALIDATE; M33.7): the editor rules engine in the
     * {@code generation} scope — built-ins and the templates' rules, section instances with their section templates'
     * — on the snapshot, with the project's languages (so a localizable editor is checked per language, as at
     * release). Each language renders its own version of the page (M27.2.1), so only findings of the validated
     * language (or of no language) count for it.
     *
     * <ul>
     *   <li>an {@code error} with {@code onGeneration holdBack} (every built-in) holds back that page language: one
     *       {@code SF-GEN-0120} listing the findings; the rest of the plan still renders;
     *   <li>an {@code error} with {@code onGeneration fail} fails the run: one {@code SF-GEN-0121} per page, language
     *       and rule, every page validated first; nothing renders or publishes;
     *   <li>a {@code warning} or {@code info} is a run diagnostic ({@code SF-GEN-0122}); only warnings count.
     * </ul>
     *
     * Structural findings are the save path's concern ({@code PageContentValidation}) and don't block here.
     */
    private Validation validateContent(Snapshot snapshot, BuildPlan plan, LocaleConfig locales) {
        TemplateCompileMemo memo = compiledTemplates.buildMemo(snapshot.root());
        SectionTemplateLookup sections = snapshotSectionTemplates(snapshot, memo);
        LocalizationContext localization = locales == null ? LocalizationContext.NONE : LocalizationContext.of(locales);
        RuleEngine engine = new RuleEngine(new ContentValidator(new ExpressionEvaluator(), null, null, localization));
        SnapshotRuleContexts contexts = new SnapshotRuleContexts(snapshot, localization);
        Map<PageLocale, Diagnostic> heldBack = new LinkedHashMap<>();
        List<Diagnostic> failures = new ArrayList<>();
        List<Diagnostic> findings = new ArrayList<>();
        Set<PageLocale> seen = new HashSet<>();
        for (PlanEntry entry : plan.entries()) {
            if (!seen.add(PageLocale.of(entry))) {
                continue;
            }
            Snapshot view = snapshot.in(entry.locale());
            SnapshotAsset page = view.assetByUuid(entry.pageUuid());
            SnapshotAsset template = page == null ? null : GenerationRenderer.templateOf(view, page);
            if (template == null) {
                continue;
            }
            ContentDefinition definition = definitionOf(memo, template, snapshot);
            String locale = localization.localized() ? entry.locale() : null;
            RuleOutcome outcome = engine.evaluatePage(definition, page.payload(), sections, new RuleEngine.Request(
                    RuleScope.GENERATION, locale == null ? null : List.of(locale), contexts.of(page, template)));
            String pageName = "page '" + (page.uid() != null ? page.uid() : page.uuid()) + "'"
                    + (entry.locale() == null ? "" : " (" + entry.locale() + ")");
            List<ContentIssue> holding = new ArrayList<>();
            for (ContentIssue issue : outcome.findings()) {
                if (issue.kind() != ContentIssue.Kind.COMPLETENESS
                        || locale != null && issue.locale() != null && !issue.locale().equals(locale)) {
                    continue;
                }
                String where = issue.path().isEmpty() ? "" : issue.path() + ": ";
                String rule = issue.rule() == null ? "" : "Rule '" + issue.rule() + "' on ";
                if (issue.severity() == Severity.ERROR && issue.onGeneration() == OnGeneration.FAIL) {
                    failures.add(Diagnostic.error(GenerationDiagnosticCodes.GEN_RULE_FAILED,
                            rule + pageName + " failed: " + where + issue.message(), 0, 0));
                } else if (issue.severity() == Severity.ERROR) {
                    holding.add(issue);
                } else if (issue.severity() == Severity.WARNING || issue.severity() == Severity.INFO) {
                    findings.add(new Diagnostic(issue.severity(), GenerationDiagnosticCodes.GEN_RULE_FINDING,
                            rule + pageName + ": " + where + issue.message(), 0, 0));
                }
            }
            if (!holding.isEmpty()) {
                String listed = holding.stream()
                        .map(issue -> issue.path() + " (" + issue.message() + ")")
                        .collect(Collectors.joining("; "));
                heldBack.put(PageLocale.of(entry), Diagnostic.error(
                        GenerationDiagnosticCodes.GEN_CONTENT_INCOMPLETE,
                        "Content incomplete for " + pageName + ": " + listed,
                        0,
                        0));
            }
        }
        return new Validation(heldBack, failures, findings);
    }

    /** One language of a page — what completeness holds back (M27.2.1); {@code locale} is null without locales. */
    private record PageLocale(UUID page, String locale) {

        static PageLocale of(PlanEntry entry) {
            return new PageLocale(entry.pageUuid(), entry.locale());
        }
    }

    /** Section templates as of the snapshot; definitions come from the build's compile memo. */
    private static SectionTemplateLookup snapshotSectionTemplates(Snapshot snapshot, TemplateCompileMemo memo) {
        Map<String, Optional<SectionTemplate>> resolved = new HashMap<>();
        return templateRef -> resolved.computeIfAbsent(templateRef, ref -> {
            try {
                return Optional.ofNullable(snapshot.assetByUuid(UUID.fromString(ref)))
                        .filter(asset -> asset.type() == AssetType.SECTION_TEMPLATE && !asset.deleted())
                        .map(asset -> new SectionTemplate(asset.uid(), definitionOf(memo, asset, snapshot)));
            } catch (IllegalArgumentException e) {
                return Optional.empty();
            }
        });
    }

    /** A section template's own definition; a page template's effective one, own and inherited (M20). */
    private static ContentDefinition definitionOf(TemplateCompileMemo memo, SnapshotAsset template, Snapshot snapshot) {
        if (template.type() == AssetType.PAGE_TEMPLATE) {
            Optional<ContentDefinition> effective = SnapshotTemplateHierarchy.of(snapshot, memo)
                    .effectiveDefinition(template.uuid())
                    .map(EffectiveDefinition::definition);
            if (effective.isPresent()) {
                return effective.get();
            }
        }
        return memo.definition(template.uuid(), CdlSources.of(template.payload()));
    }

    /**
     * Executes the pipeline against an explicit {@link OutputPathResolver} (matching the one the
     * planner used, built from the channels' output settings), so page references resolve to the
     * same paths the plan writes.
     */
    public RenderOutcome execute(Snapshot snapshot, BuildPlan plan, OutputPathResolver paths) {
        return execute(snapshot, plan, paths, null);
    }

    /**
     * Same as {@link #execute(Snapshot, BuildPlan, OutputPathResolver)}, threading the
     * generation run's triggering user (`M8.2.3`: the `RevisionContext.userId()` a nav node's
     * {@code $CMS_NAVIGATION}-rendered {@code PageReference} href resolves through the URL
     * registry with) — {@code null} for a run with no attributable user.
     */
    public RenderOutcome execute(Snapshot snapshot, BuildPlan plan, OutputPathResolver paths, Long userId) {
        return execute(snapshot, plan, paths, userId, RunCheckpoint.NONE);
    }

    /**
     * Same as {@link #execute(Snapshot, BuildPlan, OutputPathResolver, Long)}, calling {@code checkpoint} on the render
     * thread before each page renders (M29.2.1): a {@link RunAbortedException} it throws cancels the pages still pending
     * and propagates, so a cancelled run stops within one page per render thread.
     */
    public RenderOutcome execute(
            Snapshot snapshot, BuildPlan plan, OutputPathResolver paths, Long userId, RunCheckpoint checkpoint) {
        List<Diagnostic> errors = validate(snapshot, plan);
        if (!errors.isEmpty()) {
            return new RenderOutcome(List.of(), errors, List.of());
        }

        List<Diagnostic> notLocaleDistinct = localeDistinctErrors(snapshot, plan, paths);
        if (!notLocaleDistinct.isEmpty()) {
            return new RenderOutcome(List.of(), notLocaleDistinct, List.of());
        }

        List<OutputPathResolver.Collision> collisions = new ArrayList<>(paths.findCollisions(plan.entries()));
        // A first-time URL another target holds in the URL registry collides like two outputs on one path (M32.3).
        Set<String> reported = new java.util.HashSet<>();
        collisions.forEach(collision -> reported.add(collision.path()));
        paths.registryCollisions().stream().filter(collision -> reported.add(collision.path())).forEach(collisions::add);
        if (!collisions.isEmpty()) {
            throw collisionError(collisions);
        }

        String projectKey = projects.findById(snapshot.projectId()).map(Project::getKey).orElse("");
        Renderers renderers = new Renderers(snapshot, paths, projectKey, userId);

        Validation validation = validateContent(snapshot, plan, paths.locales());
        if (!validation.failures().isEmpty()) {
            // An onGeneration fail rule: the run fails before anything renders, every failing page reported (M33.7).
            return new RenderOutcome(List.of(), validation.failures(), validation.findings(),
                    List.copyOf(validation.heldBack().values()));
        }
        Map<PageLocale, Diagnostic> incomplete = validation.heldBack();
        BuildPlan publishable = incomplete.isEmpty()
                ? plan
                : plan.withEntries(plan.entries().stream().filter(e -> !incomplete.containsKey(PageLocale.of(e))).toList());
        RenderBatch batch = renderParallel(renderers, publishable, snapshot, checkpoint);

        List<RenderedFile> files = new ArrayList<>(batch.files);
        files.sort(Comparator.comparing(RenderedFile::outputPath));
        List<Diagnostic> pageErrors = new ArrayList<>(incomplete.values());
        pageErrors.addAll(batch.pageErrors);
        List<Diagnostic> warnings = new ArrayList<>(validation.findings());
        warnings.addAll(batch.warnings);
        return new RenderOutcome(
                List.copyOf(files), List.copyOf(batch.errors), List.copyOf(warnings), List.copyOf(pageErrors));

    }

    /** How many pages a {@code SF-GEN-0111} message names before it counts the rest. */
    private static final int LOCALE_DISTINCT_PAGES_LISTED = 5;

    /**
     * In a localized project every page's path expression must contain {@code {locale}}, or two
     * languages would write the same file and one would silently win. Reported before anything renders as
     * {@code SF-GEN-0111} (M24.3.2), once per (channel, path expression) — the pages sharing a template share the
     * message — naming the affected pages (uid, display name and path) rather than their UUIDs (M35.1).
     */
    private List<Diagnostic> localeDistinctErrors(Snapshot snapshot, BuildPlan plan, OutputPathResolver paths) {
        if (!LocaleConfig.orEmpty(paths.locales()).isLocalized()) {
            return List.of();
        }
        Map<PathKey, Set<UUID>> pagesByPath = new LinkedHashMap<>();
        for (PlanEntry entry : plan.entries()) {
            // Each language renders its own version of the page (M27.2.1), so one language's expression may differ.
            String expression = paths.effectiveExpression(entry.pageUuid(), entry.channel(), entry.locale());
            if (!com.acme.staticforge.channel.OutputPathExpander.isLocaleDistinct(expression)) {
                pagesByPath
                        .computeIfAbsent(new PathKey(entry.channel(), expression), key -> new LinkedHashSet<>())
                        .add(entry.pageUuid());
            }
        }
        List<Diagnostic> errors = new ArrayList<>();
        pagesByPath.forEach((key, pages) -> {
            List<String> named = pages.stream().limit(LOCALE_DISTINCT_PAGES_LISTED).map(uuid -> pageLabel(snapshot, uuid)).toList();
            String rest = pages.size() > named.size() ? " and " + (pages.size() - named.size()) + " more" : "";
            errors.add(Diagnostic.error(
                            NOT_LOCALE_DISTINCT_CODE,
                            "Output path '" + key.expression() + "' is not language-distinct: this project has several "
                                    + "languages, so the path needs a {locale} segment or they would overwrite each other "
                                    + "(channel " + key.channel() + ", " + pages.size() + (pages.size() == 1 ? " page: " : " pages: ")
                                    + String.join(", ", named) + rest + "). Fix the page template's output path, or the "
                                    + "page's own path override.",
                            0,
                            0)
                    .withPages(pages.stream()
                            .limit(Diagnostic.MAX_PAGES)
                            .map(uuid -> diagnosticPage(snapshot, uuid))
                            .toList()));
        });
        return List.copyOf(errors);
    }

    /** A channel and the path expression a page in it is written by. */
    private record PathKey(String channel, String expression) {}

    /** {@code 'uid' (Display name, /folder/uid)} — how a run finding names a page; the uuid when the snapshot lost it. */
    private static String pageLabel(Snapshot snapshot, UUID pageUuid) {
        DiagnosticPage page = diagnosticPage(snapshot, pageUuid);
        return page.uid() == null ? pageUuid.toString() : "'" + page.uid() + "' (" + page.displayName() + ", " + page.path() + ")";
    }

    /** The page as data for a run finding ({@link Diagnostic#pages()}); only its uuid when the snapshot lost it. */
    private static DiagnosticPage diagnosticPage(Snapshot snapshot, UUID pageUuid) {
        SnapshotAsset page = snapshot.assetByUuid(pageUuid);
        if (page == null) {
            return new DiagnosticPage(pageUuid, null, null, null);
        }
        String folder = page.folderPath() == null ? "" : page.folderPath();
        String root = "/" + FolderScope.PAGES_ROOT_UID;
        folder = folder.startsWith(root) ? folder.substring(root.length()) : folder;
        String uid = page.uid() != null ? page.uid() : pageUuid.toString();
        return new DiagnosticPage(pageUuid, uid, page.displayName(), (folder.endsWith("/") ? folder : folder + "/") + uid);
    }

    /**
     * Opens the processed media renderer of a build (M18.3.1), sharing the render stage's snapshot
     * resolvers, output paths and compile memo.
     *
     * @param channel the project's default channel key
     */
    public MediaRenderSession mediaSession(Snapshot snapshot, OutputPathResolver paths, Long userId, String channel) {
        String projectKey = projects.findById(snapshot.projectId()).map(Project::getKey).orElse("");
        return new MediaRenderSession(new Renderers(snapshot, paths, projectKey, userId)::of, channel);
    }

    /**
     * Renders one plan entry for a draft check (M30.3.1): the page exactly as a build of {@code snapshot} would write it
     * — links relative to its output path, the renderer's reference events — plus section markers around every rendered
     * section instance ({@code <!--sf:section {instanceId}-->…<!--/sf:section-->}, only in body text). Stores nothing:
     * navigation links resolve straight to the planned paths instead of through the URL registry, which assigns on first
     * use.
     *
     * @throws RenderLimitException when the page hits a render limit or a dangling navigation reference — a build would
     *     hold it back
     */
    public RenderedFile renderForCheck(Snapshot snapshot, PlanEntry entry, OutputPathResolver paths) {
        String projectKey = projects.findById(snapshot.projectId()).map(Project::getKey).orElse("");
        GenerationRenderer renderer = new GenerationRenderer(
                        snapshot.in(entry.locale()), paths, projectKey, channelService,
                        compiledTemplates.buildMemo(snapshot.root()))
                .withLocales(com.acme.staticforge.project.LocaleConfig.orEmpty(paths.locales()))
                .withSectionMarkers();
        return renderer.render(entry);
    }

    /**
     * The renderers of one build, one per language view (M27.2.1): a page renders against its language's view of the
     * snapshot, so its references, navigation and values resolve to what that language has released. Every renderer
     * shares the build's compile memo. Created on first use, from the render threads.
     */
    private final class Renderers {

        private final Snapshot snapshot;
        private final OutputPathResolver paths;
        private final String projectKey;
        private final Long userId;
        private final Map<Snapshot, GenerationRenderer> byView = new ConcurrentHashMap<>();

        Renderers(Snapshot snapshot, OutputPathResolver paths, String projectKey, Long userId) {
            this.snapshot = snapshot;
            this.paths = paths;
            this.projectKey = projectKey;
            this.userId = userId;
        }

        /** The renderer of {@code locale}'s view; the root view's for {@code null}. */
        GenerationRenderer of(String locale) {
            return byView.computeIfAbsent(snapshot.in(locale), view -> new GenerationRenderer(
                            view, paths, projectKey, channelService, compiledTemplates.buildMemo(snapshot.root()))
                    .withLocales(com.acme.staticforge.project.LocaleConfig.orEmpty(paths.locales())));
        }
    }

    // ------------------------------------------------------------------
    // Parallel render
    // ------------------------------------------------------------------

    private RenderBatch renderParallel(Renderers renderers, BuildPlan plan, Snapshot snapshot, RunCheckpoint checkpoint) {
        int parallelism = Math.max(1, properties.getParallelism());
        Duration timeout = properties.renderTimeoutDuration();
        List<PlanEntry> entries = plan.entries();

        List<RenderedFile> files = new ArrayList<>(entries.size());
        List<Diagnostic> errors = new ArrayList<>();
        List<Diagnostic> warnings = new ArrayList<>();
        List<Diagnostic> pageErrors = new ArrayList<>();

        try (ExecutorService executor = Executors.newVirtualThreadPerTaskExecutor()) {
            Semaphore semaphore = new Semaphore(parallelism);
            List<Future<RenderTask>> futures = new ArrayList<>(entries.size());
            for (PlanEntry entry : entries) {
                futures.add(executor.submit(() -> {
                    semaphore.acquire();
                    try {
                        checkpoint.check();
                        return renderEntry(renderers.of(entry.locale()), snapshot.in(entry.locale()), entry);
                    } finally {
                        semaphore.release();
                    }
                }));
            }

            for (int i = 0; i < entries.size(); i++) {
                PlanEntry entry = entries.get(i);
                RenderTask task;
                try {
                    task = futures.get(i).get(timeout.toMillis(), TimeUnit.MILLISECONDS);
                } catch (TimeoutException e) {
                    // Page-scoped like the in-render time budget (SF-TPL-0133): only this page is held back.
                    futures.get(i).cancel(true);
                    pageErrors.add(Diagnostic.error(
                            "SF-GEN-0205",
                            "Render timed out for page '" + entry.pageUuid() + pageSuffix(entry) + "' (" + entry.channel() + ").",
                            0,
                            0));
                    continue;
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                    errors.add(Diagnostic.error(
                            "SF-GEN-0206", "Render interrupted for page '" + entry.pageUuid() + "'.", 0, 0));
                    continue;
                } catch (ExecutionException e) {
                    if (e.getCause() instanceof RunAbortedException aborted) {
                        futures.forEach(future -> future.cancel(true));
                        throw aborted;
                    }
                    errors.add(Diagnostic.error(
                            "SF-GEN-0206",
                            "Render failed for page '" + entry.pageUuid() + "': "
                                    + (e.getCause() == null ? e.getMessage() : e.getCause().getMessage()),
                            0,
                            0));
                    continue;
                }

                if (task.file != null) {
                    files.add(task.file);
                }
                errors.addAll(task.errors);
                warnings.addAll(task.warnings);
                pageErrors.addAll(task.pageErrors);
            }
        }

        return new RenderBatch(files, errors, warnings, pageErrors);
    }

    private RenderTask renderEntry(GenerationRenderer renderer, Snapshot snapshot, PlanEntry entry) {
        RenderedFile file;
        Timer timer = meterRegistry.timer(
                "sf.render.duration", "template", templateTag(snapshot, entry), "channel", entry.channel());
        Timer.Sample sample = Timer.start(meterRegistry);
        try {
            file = renderer.render(entry);
        } catch (RenderLimitException e) {
            // A render limit (include cycle/depth, loop, output, time budget) is an authoring error
            // local to this page: the file is held back and named in the report, the rest publishes.
            sample.stop(timer);
            return RenderTask.pageError(renderLimitDiagnostic(snapshot, entry, e.diagnostic()));
        } catch (RuntimeException e) {
            sample.stop(timer);
            return new RenderTask(
                    null,
                    List.of(Diagnostic.error(
                            "SF-GEN-0204",
                            "Render failed for '" + entry.outputPath() + "': "
                                    + (e.getMessage() == null ? e.getClass().getSimpleName() : e.getMessage()),
                            0,
                            0)),
                    List.of());
        }
        sample.stop(timer);
        if (file.bytes().length > properties.getMaxFileSize().toBytes()) {
            return RenderTask.pageError(Diagnostic.error(
                    "SF-GEN-0203",
                    "Rendered file exceeds max file size: '" + entry.outputPath() + "'.",
                    0,
                    0));
        }
        if (isMissingChannelSkip(file)) {
            return new RenderTask(null, List.of(), file.diagnostics());
        }
        return new RenderTask(file, List.of(), file.diagnostics());
    }

    /**
     * The page-scoped report entry for a render limit: the limit's own code and position, with a
     * message naming the page and channel it held back (the run diagnostics group messages by code,
     * so the page identity has to be part of the message).
     */
    private static Diagnostic renderLimitDiagnostic(Snapshot snapshot, PlanEntry entry, Diagnostic limit) {
        SnapshotAsset page = snapshot.assetByUuid(entry.pageUuid());
        String pageName = (page != null && page.uid() != null ? page.uid() : entry.pageUuid().toString()) + pageSuffix(entry);
        String prefix = "Page '" + pageName + "' (" + entry.channel() + "): ";
        if (limit == null) {
            return Diagnostic.error("SF-GEN-0204", prefix + "render limit exceeded for '" + entry.outputPath() + "'.", 0, 0);
        }
        return new Diagnostic(limit.severity(), limit.code(), prefix + limit.message(), limit.line(), limit.column());
    }

    /** {@code " (2/5)"} for page 2 of a paginated page (M21.2.2), so the report tells its outputs apart; else empty. */
    static String pageSuffix(PlanEntry entry) {
        return entry.pagination() == null
                ? ""
                : " (" + entry.pagination().pageNumber() + "/" + entry.pagination().totalPages() + ")";
    }

    /** A zero-output file whose only findings are SF-GEN-0210 skips emitting (spec §15.4). */
    private static boolean isMissingChannelSkip(RenderedFile file) {
        if (file.bytes().length != 0 || file.diagnostics().isEmpty()) {
            return false;
        }
        return file.diagnostics().stream()
                .allMatch(d -> GenerationDiagnosticCodes.GEN_CHANNEL_MISSING.equals(d.code()));
    }

    /** {@code 422 SF-GEN-0110} naming every colliding path and its two owners. */
    public static SfException collisionError(List<OutputPathResolver.Collision> collisions) {
        StringBuilder detail = new StringBuilder("Output path collision: ");
        for (int i = 0; i < collisions.size(); i++) {
            OutputPathResolver.Collision c = collisions.get(i);
            if (i > 0) {
                detail.append("; ");
            }
            detail.append("'").append(c.path()).append("' between '").append(c.uidA()).append("' and '")
                    .append(c.uidB()).append("'");
        }
        return new SfException(ProblemFactory.other(422, COLLISION_CODE, "Build Failed", detail.toString()));
    }

    /** The template UID for a plan entry, or {@code "none"} when the page/template is unresolvable. */
    private static String templateTag(Snapshot snapshot, PlanEntry entry) {
        SnapshotAsset page = snapshot.assetByUuid(entry.pageUuid());
        SnapshotAsset template = page == null ? null : GenerationRenderer.templateOf(snapshot, page);
        if (template == null) {
            return "none";
        }
        return template.uid() != null ? template.uid() : template.uuid().toString();
    }

    /**
     * One entry's result. {@code pageErrors} only hold this page back (run PARTIAL): render limits
     * ({@code SF-TPL-0130}–{@code 0135}), the per-page render timeout ({@code SF-GEN-0205}) and an
     * oversized file ({@code SF-GEN-0203}) — deterministic, authoring-caused and local to the page.
     * {@code errors} abort the run: an unexpected render exception ({@code SF-GEN-0204}) or an
     * interrupted/failed task ({@code SF-GEN-0206}) signals a defect, not content, so nothing is published.
     */
    private record RenderTask(
            RenderedFile file, List<Diagnostic> errors, List<Diagnostic> warnings, List<Diagnostic> pageErrors) {

        RenderTask(RenderedFile file, List<Diagnostic> errors, List<Diagnostic> warnings) {
            this(file, errors, warnings, List.of());
        }

        static RenderTask pageError(Diagnostic diagnostic) {
            return new RenderTask(null, List.of(), List.of(), List.of(diagnostic));
        }
    }

    private record RenderBatch(
            List<RenderedFile> files,
            List<Diagnostic> errors,
            List<Diagnostic> warnings,
            List<Diagnostic> pageErrors) {}
}
