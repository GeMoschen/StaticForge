package com.acme.staticforge.generate.render;

import com.acme.staticforge.asset.AssetType;
import com.acme.staticforge.asset.content.ContentIssue;
import com.acme.staticforge.asset.content.PageContentValidator;
import com.acme.staticforge.asset.content.SectionTemplateLookup;
import com.acme.staticforge.asset.content.SectionTemplateLookup.SectionTemplate;
import com.acme.staticforge.asset.template.CompiledTemplateCache;
import com.acme.staticforge.asset.template.TemplateCompileMemo;
import com.acme.staticforge.channel.ChannelService;
import com.acme.staticforge.common.ProblemFactory;
import com.acme.staticforge.common.SfException;
import com.acme.staticforge.generate.GenerationDiagnosticCodes;
import com.acme.staticforge.generate.GenerationProperties;
import com.acme.staticforge.generate.pipeline.RenderedFile;
import com.acme.staticforge.generate.plan.BuildPlan;
import com.acme.staticforge.generate.plan.PlanEntry;
import com.acme.staticforge.generate.snapshot.Snapshot;
import com.acme.staticforge.generate.snapshot.SnapshotAsset;
import com.acme.staticforge.project.Project;
import com.acme.staticforge.project.ProjectRepository;
import com.acme.staticforge.template.content.ContentDefinition;
import com.acme.staticforge.template.diagnostic.Diagnostic;
import com.acme.staticforge.template.diagnostic.Severity;
import com.acme.staticforge.template.render.RenderLimitException;
import com.acme.staticforge.urlregistry.UrlRegistryService;
import io.micrometer.core.instrument.MeterRegistry;
import io.micrometer.core.instrument.Timer;
import java.time.Duration;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;
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

    private final PageContentValidator contentValidator = new PageContentValidator();

    private final GenerationProperties properties;
    private final ProjectRepository projects;
    private final ChannelService channelService;
    private final MeterRegistry meterRegistry;
    private final UrlRegistryService urlRegistryService;
    private final CompiledTemplateCache compiledTemplates;

    public RenderPipeline(
            GenerationProperties properties,
            ProjectRepository projects,
            ChannelService channelService,
            MeterRegistry meterRegistry,
            UrlRegistryService urlRegistryService,
            CompiledTemplateCache compiledTemplates) {
        this.properties = properties;
        this.projects = projects;
        this.channelService = channelService;
        this.meterRegistry = meterRegistry;
        this.urlRegistryService = urlRegistryService;
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
                snapshot, null, "", channelService, null, null, compiledTemplates.buildMemo(snapshot));
        Set<String> seen = new HashSet<>();
        List<Diagnostic> errors = new ArrayList<>();
        for (PlanEntry entry : plan.entries()) {
            SnapshotAsset page = snapshot.assetByUuid(entry.pageUuid());
            if (page == null) {
                errors.add(Diagnostic.error(
                        "SF-GEN-0202", "Page missing from snapshot: " + entry.pageUuid(), 0, 0));
                continue;
            }
            SnapshotAsset template = GenerationRenderer.templateOf(snapshot, page);
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
     * Completeness validation per planned page (spec §10.5, VALIDATE): validates each page's
     * content, bodies and sections against its snapshot templates and returns one
     * {@code SF-GEN-0120} per page with ERROR-severity completeness findings (listing their paths),
     * keyed by page UUID. Those pages are not rendered; the rest of the plan still is. Structural
     * findings are the save path's concern ({@code PageContentValidation}) and don't block here.
     */
    public Map<UUID, Diagnostic> incompletePages(Snapshot snapshot, BuildPlan plan) {
        TemplateCompileMemo memo = compiledTemplates.buildMemo(snapshot);
        SectionTemplateLookup sections = snapshotSectionTemplates(snapshot, memo);
        Map<UUID, Diagnostic> incomplete = new LinkedHashMap<>();
        Set<UUID> seen = new HashSet<>();
        for (PlanEntry entry : plan.entries()) {
            if (!seen.add(entry.pageUuid())) {
                continue;
            }
            SnapshotAsset page = snapshot.assetByUuid(entry.pageUuid());
            SnapshotAsset template = page == null ? null : GenerationRenderer.templateOf(snapshot, page);
            if (template == null) {
                continue;
            }
            ContentDefinition definition = definitionOf(memo, template);
            List<ContentIssue> blocking = contentValidator.validatePage(definition, page.payload(), sections).stream()
                    .filter(issue -> issue.kind() == ContentIssue.Kind.COMPLETENESS)
                    .filter(issue -> issue.severity() == Severity.ERROR)
                    .toList();
            if (!blocking.isEmpty()) {
                String findings = blocking.stream()
                        .map(issue -> issue.path() + " (" + issue.message() + ")")
                        .collect(Collectors.joining("; "));
                incomplete.put(entry.pageUuid(), Diagnostic.error(
                        GenerationDiagnosticCodes.GEN_CONTENT_INCOMPLETE,
                        "Content incomplete for page '" + (page.uid() != null ? page.uid() : page.uuid()) + "': " + findings,
                        0,
                        0));
            }
        }
        return incomplete;
    }

    /** Section templates as of the snapshot; definitions come from the build's compile memo. */
    private static SectionTemplateLookup snapshotSectionTemplates(Snapshot snapshot, TemplateCompileMemo memo) {
        Map<String, Optional<SectionTemplate>> resolved = new HashMap<>();
        return templateRef -> resolved.computeIfAbsent(templateRef, ref -> {
            try {
                return Optional.ofNullable(snapshot.assetByUuid(UUID.fromString(ref)))
                        .filter(asset -> asset.type() == AssetType.SECTION_TEMPLATE && !asset.deleted())
                        .map(asset -> new SectionTemplate(asset.uid(), definitionOf(memo, asset)));
            } catch (IllegalArgumentException e) {
                return Optional.empty();
            }
        });
    }

    private static ContentDefinition definitionOf(TemplateCompileMemo memo, SnapshotAsset template) {
        return memo.definition(template.uuid(), template.payload().path("contentDefinition").asText(""));
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
        List<Diagnostic> errors = validate(snapshot, plan);
        if (!errors.isEmpty()) {
            return new RenderOutcome(List.of(), errors, List.of());
        }

        List<OutputPathResolver.Collision> collisions = paths.findCollisions(plan.entries());
        if (!collisions.isEmpty()) {
            throw collisionError(collisions);
        }

        String projectKey = projects.findById(snapshot.projectId()).map(Project::getKey).orElse("");
        GenerationRenderer renderer =
                new GenerationRenderer(snapshot, paths, projectKey, channelService, urlRegistryService, userId,
                        compiledTemplates.buildMemo(snapshot));

        Map<UUID, Diagnostic> incomplete = incompletePages(snapshot, plan);
        BuildPlan publishable = incomplete.isEmpty()
                ? plan
                : new BuildPlan(
                        plan.incremental(),
                        plan.revision(),
                        plan.entries().stream().filter(e -> !incomplete.containsKey(e.pageUuid())).toList(),
                        plan.changedAssets());
        RenderBatch batch = renderParallel(renderer, publishable, snapshot);

        List<RenderedFile> files = new ArrayList<>(batch.files);
        files.sort(Comparator.comparing(RenderedFile::outputPath));
        List<Diagnostic> pageErrors = new ArrayList<>(incomplete.values());
        pageErrors.addAll(batch.pageErrors);
        return new RenderOutcome(
                List.copyOf(files), List.copyOf(batch.errors), List.copyOf(batch.warnings), List.copyOf(pageErrors));

    }

    // ------------------------------------------------------------------
    // Parallel render
    // ------------------------------------------------------------------

    private RenderBatch renderParallel(GenerationRenderer renderer, BuildPlan plan, Snapshot snapshot) {
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
                        return renderEntry(renderer, snapshot, entry);
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
                            "Render timed out for page '" + entry.pageUuid() + "' (" + entry.channel() + ").",
                            0,
                            0));
                    continue;
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                    errors.add(Diagnostic.error(
                            "SF-GEN-0206", "Render interrupted for page '" + entry.pageUuid() + "'.", 0, 0));
                    continue;
                } catch (ExecutionException e) {
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
        String pageName = page != null && page.uid() != null ? page.uid() : entry.pageUuid().toString();
        String prefix = "Page '" + pageName + "' (" + entry.channel() + "): ";
        if (limit == null) {
            return Diagnostic.error("SF-GEN-0204", prefix + "render limit exceeded for '" + entry.outputPath() + "'.", 0, 0);
        }
        return new Diagnostic(limit.severity(), limit.code(), prefix + limit.message(), limit.line(), limit.column());
    }

    /** A zero-output file whose only findings are SF-GEN-0210 skips emitting (spec §15.4). */
    private static boolean isMissingChannelSkip(RenderedFile file) {
        if (file.bytes().length != 0 || file.diagnostics().isEmpty()) {
            return false;
        }
        return file.diagnostics().stream()
                .allMatch(d -> GenerationDiagnosticCodes.GEN_CHANNEL_MISSING.equals(d.code()));
    }

    private static SfException collisionError(List<OutputPathResolver.Collision> collisions) {
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
