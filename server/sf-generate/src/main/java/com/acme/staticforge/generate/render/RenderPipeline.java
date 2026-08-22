package com.acme.staticforge.generate.render;

import com.acme.staticforge.channel.ChannelService;
import com.acme.staticforge.common.ProblemFactory;
import com.acme.staticforge.common.SfException;
import com.acme.staticforge.generate.GenerationDiagnosticCodes;
import com.acme.staticforge.generate.GenerationProperties;
import com.acme.staticforge.generate.nav.NavRenderer;
import com.acme.staticforge.generate.pipeline.RenderedFile;
import com.acme.staticforge.generate.plan.BuildPlan;
import com.acme.staticforge.generate.plan.PlanEntry;
import com.acme.staticforge.generate.snapshot.Snapshot;
import com.acme.staticforge.generate.snapshot.SnapshotAsset;
import com.acme.staticforge.project.Project;
import com.acme.staticforge.project.ProjectRepository;
import com.acme.staticforge.template.diagnostic.Diagnostic;
import com.acme.staticforge.template.render.RenderLimitException;
import io.micrometer.core.instrument.MeterRegistry;
import io.micrometer.core.instrument.Timer;
import java.time.Duration;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
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
 * collisions, then render every plan entry in parallel over virtual threads bounded by
 * {@link GenerationProperties#getParallelism}. Exposes the last run's page → dependency map for
 * the orchestrator to persist into {@code asset_reference}.
 */
@Service
public class RenderPipeline {

    private static final String COLLISION_CODE = "SF-GEN-0110";

    private final GenerationProperties properties;
    private final ProjectRepository projects;
    private final ChannelService channelService;
    private final NavRenderer navRenderer;
    private final MeterRegistry meterRegistry;

    private volatile Map<UUID, Set<UUID>> dependenciesByPage = Map.of();

    public RenderPipeline(
            GenerationProperties properties,
            ProjectRepository projects,
            ChannelService channelService,
            NavRenderer navRenderer,
            MeterRegistry meterRegistry) {
        this.properties = properties;
        this.projects = projects;
        this.channelService = channelService;
        this.navRenderer = navRenderer;
        this.meterRegistry = meterRegistry;
    }

    /**
     * Compiles every page template channel in the plan and returns the union of ERROR diagnostics
     * (empty when the plan validates cleanly). Section templates are validated transitively as
     * the renderer encounters them.
     */
    public List<Diagnostic> validate(Snapshot snapshot, BuildPlan plan) {
        GenerationRenderer renderer = new GenerationRenderer(snapshot, null, "", channelService, navRenderer);
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
     * Executes the pipeline with the project's default output configuration
     * ({@code indexUid="index"}, {@code trailingSlash=false}, {@code urlStrategy="RELATIVE"}).
     */
    public RenderOutcome execute(Snapshot snapshot, BuildPlan plan) {
        return execute(snapshot, plan, OutputPathResolver.forSnapshot(
                snapshot, OutputPathResolver.DEFAULT_INDEX_UID, false, "RELATIVE"));
    }

    /**
     * Executes the pipeline against an explicit {@link OutputPathResolver} (matching the one the
     * planner used), so PRETTY/trailing-slash projects resolve page references correctly.
     */
    public RenderOutcome execute(Snapshot snapshot, BuildPlan plan, OutputPathResolver paths) {
        List<Diagnostic> errors = validate(snapshot, plan);
        if (!errors.isEmpty()) {
            return new RenderOutcome(List.of(), errors, List.of());
        }

        List<OutputPathResolver.Collision> collisions = paths.findCollisions(plan.entries());
        if (!collisions.isEmpty()) {
            throw collisionError(collisions);
        }

        String projectKey = projects.findById(snapshot.projectId()).map(Project::getKey).orElse("");
        GenerationRenderer renderer = new GenerationRenderer(snapshot, paths, projectKey, channelService, navRenderer);

        RenderBatch batch = renderParallel(renderer, plan, snapshot);

        this.dependenciesByPage = Map.copyOf(batch.dependencies);

        List<RenderedFile> files = new ArrayList<>(batch.files);
        files.sort(Comparator.comparing(RenderedFile::outputPath));
        return new RenderOutcome(List.copyOf(files), List.copyOf(batch.errors), List.copyOf(batch.warnings));
    }

    /** The page UUID → referenced asset UUID map from the most recent {@link #execute}. */
    public Map<UUID, Set<UUID>> dependenciesByPage() {
        return dependenciesByPage;
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
        Map<UUID, Set<UUID>> dependencies = new HashMap<>();

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
                    futures.get(i).cancel(true);
                    errors.add(Diagnostic.error(
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
                    if (!task.file.dependencies().isEmpty()) {
                        dependencies.put(entry.pageUuid(), task.file.dependencies());
                    }
                }
                errors.addAll(task.errors);
                warnings.addAll(task.warnings);
            }
        }

        return new RenderBatch(files, errors, warnings, dependencies);
    }

    private RenderTask renderEntry(GenerationRenderer renderer, Snapshot snapshot, PlanEntry entry) {
        RenderedFile file;
        Timer timer = meterRegistry.timer(
                "sf.render.duration", "template", templateTag(snapshot, entry), "channel", entry.channel());
        Timer.Sample sample = Timer.start(meterRegistry);
        try {
            file = renderer.render(entry);
        } catch (RenderLimitException e) {
            sample.stop(timer);
            Diagnostic diagnostic = e.diagnostic();
            if (diagnostic == null) {
                diagnostic = Diagnostic.error(
                        "SF-GEN-0204", "Render limit exceeded for '" + entry.outputPath() + "'.", 0, 0);
            }
            return new RenderTask(null, List.of(diagnostic), List.of());
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
            return new RenderTask(
                    null,
                    List.of(Diagnostic.error(
                            "SF-GEN-0203",
                            "Rendered file exceeds max file size: '" + entry.outputPath() + "'.",
                            0,
                            0)),
                    List.of());
        }
        if (isMissingChannelSkip(file)) {
            return new RenderTask(null, List.of(), file.diagnostics());
        }
        return new RenderTask(file, List.of(), file.diagnostics());
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

    private record RenderTask(RenderedFile file, List<Diagnostic> errors, List<Diagnostic> warnings) {}

    private record RenderBatch(
            List<RenderedFile> files,
            List<Diagnostic> errors,
            List<Diagnostic> warnings,
            Map<UUID, Set<UUID>> dependencies) {}
}
