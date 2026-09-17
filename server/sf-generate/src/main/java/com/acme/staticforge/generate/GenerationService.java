package com.acme.staticforge.generate;

import com.acme.staticforge.asset.AssetType;
import com.acme.staticforge.channel.ChannelService;
import com.acme.staticforge.common.ProblemFactory;
import com.acme.staticforge.common.SfException;
import com.acme.staticforge.generate.insight.FallbackCause;
import com.acme.staticforge.generate.insight.PlanEntryRecord;
import com.acme.staticforge.generate.insight.RunPlanStore;
import com.acme.staticforge.generate.plan.Baseline;
import com.acme.staticforge.generate.plan.BuildPlan;
import com.acme.staticforge.generate.plan.BuildPlanner;
import com.acme.staticforge.generate.plan.PlanRequest;
import com.acme.staticforge.generate.pipeline.OutputFile;
import com.acme.staticforge.generate.pipeline.RenderedFile;
import com.acme.staticforge.generate.render.OutputPathResolver;
import com.acme.staticforge.generate.render.RenderOutcome;
import com.acme.staticforge.generate.render.RenderPipeline;
import com.acme.staticforge.generate.snapshot.Snapshot;
import com.acme.staticforge.generate.snapshot.SnapshotAsset;
import com.acme.staticforge.generate.snapshot.SnapshotService;
import com.acme.staticforge.generate.stage.AssetCopyResult;
import com.acme.staticforge.generate.stage.AssetCopyStage;
import com.acme.staticforge.generate.stage.CarryForward;
import com.acme.staticforge.generate.stage.MediaRenderStage;
import com.acme.staticforge.generate.stage.PostProcessContext;
import com.acme.staticforge.generate.stage.PostProcessStage;
import com.acme.staticforge.generate.target.BuildManifest;
import com.acme.staticforge.generate.target.TargetWriter;
import com.acme.staticforge.generate.target.TargetWriterSelector;
import com.acme.staticforge.project.Project;
import com.acme.staticforge.project.ProjectService;
import com.acme.staticforge.template.diagnostic.Diagnostic;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import io.micrometer.core.instrument.MeterRegistry;
import io.micrometer.core.instrument.Timer;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

/**
 * Generation orchestration (spec §18.5): the run queue, status machine, and full-pipeline
 * execution. {@link #start} validates the one-active-run-per-project invariant, records a QUEUED
 * row, and hands the run to a per-task virtual thread; each stage emits a {@code progress} SSE
 * event to registered emitters.
 *
 * <p>A single-node design (§26.2): the active-run guard is checked under the {@code startLock}
 * JVM lock plus a DB-state check, and SSE emitters are held in-memory. Multi-node deployments must
 * route generation + SSE for a project to one instance (or add a distributed lock) — out of scope
 * for M4.
 */
@Service
public class GenerationService {

    private static final Logger log = LoggerFactory.getLogger(GenerationService.class);

    /** Run status reported as PARTIAL when the render produced tolerated warnings. */
    static final String STAGE_SNAPSHOT = "SNAPSHOT";
    static final String STAGE_PLAN = "PLAN";
    static final String STAGE_VALIDATE = "VALIDATE";
    static final String STAGE_RENDER = "RENDER";
    static final String STAGE_ASSETS = "ASSETS";
    static final String STAGE_POST = "POST";
    static final String STAGE_WRITE = "WRITE";
    static final String STAGE_REPORT = "REPORT";

    private static final long SSE_TIMEOUT_MILLIS = 30L * 60 * 1000;
    private static final String CONFLICT_CODE = "SF-GEN-0500";
    private static final String NO_TARGET_CODE = "SF-GEN-0502";
    private static final String UNEXPECTED_CODE = "SF-GEN-0501";
    private static final String SEARCH_INDEX_PATH = "search-index.json";

    private final GenerationRunRepository runs;
    private final GenerationTargetRepository targets;
    private final ProjectService projectService;
    private final ChannelService channelService;
    private final SnapshotService snapshotService;
    private final BuildPlanner buildPlanner;
    private final RenderPipeline renderPipeline;
    private final AssetCopyStage assetCopyStage;
    private final MediaRenderStage mediaRenderStage;
    private final PostProcessStage postProcessStage;
    private final TargetWriterSelector targetWriterSelector;
    private final RunPlanStore runPlanStore;
    private final GenerationProperties properties;
    private final ObjectMapper mapper;
    private final MeterRegistry meterRegistry;

    private final Object startLock = new Object();
    private final ExecutorService executor = Executors.newVirtualThreadPerTaskExecutor();
    private final Map<String, Long> idempotencyKeys = new ConcurrentHashMap<>();
    private final Map<Long, List<SseEmitter>> emittersByRun = new ConcurrentHashMap<>();

    public GenerationService(
            GenerationRunRepository runs,
            GenerationTargetRepository targets,
            ProjectService projectService,
            ChannelService channelService,
            SnapshotService snapshotService,
            BuildPlanner buildPlanner,
            RenderPipeline renderPipeline,
            AssetCopyStage assetCopyStage,
            MediaRenderStage mediaRenderStage,
            PostProcessStage postProcessStage,
            TargetWriterSelector targetWriterSelector,
            RunPlanStore runPlanStore,
            GenerationProperties properties,
            ObjectMapper mapper,
            MeterRegistry meterRegistry) {
        this.runs = runs;
        this.targets = targets;
        this.projectService = projectService;
        this.channelService = channelService;
        this.snapshotService = snapshotService;
        this.buildPlanner = buildPlanner;
        this.renderPipeline = renderPipeline;
        this.assetCopyStage = assetCopyStage;
        this.mediaRenderStage = mediaRenderStage;
        this.postProcessStage = postProcessStage;
        this.targetWriterSelector = targetWriterSelector;
        this.runPlanStore = runPlanStore;
        this.properties = properties;
        this.mapper = mapper;
        this.meterRegistry = meterRegistry;
    }

    /**
     * Queues a generation run (spec §18.5, §20.1). Enforces one active run per project and
     * idempotent re-submission by {@code Idempotency-Key}, then submits the run to the executor.
     */
    @Transactional
    public GenerationRun start(String projectKey, GenerationRequest request, Long userId) {
        synchronized (startLock) {
            String idemKey = trimmed(request.idempotencyKey());
            if (idemKey != null) {
                Long previous = idempotencyKeys.get(idemKey);
                if (previous != null) {
                    return runs.findById(previous).orElse(null);
                }
            }

            long projectId = projectService.requireByKey(projectKey).getId();
            runs.findActive(projectId).ifPresent(active -> {
                throw new SfException(ProblemFactory.other(
                        409, CONFLICT_CODE, "Conflict", "A generation is already running (run " + active.getId() + ")."));
            });

            GenerationRun run = new GenerationRun(
                    projectId,
                    request.revision(),
                    request.mode() == null ? GenerationMode.FULL : request.mode(),
                    channelsJson(request.channels()),
                    request.targetId(),
                    RunStatus.QUEUED,
                    Instant.now(),
                    null,
                    userId,
                    0,
                    0,
                    0,
                    0,
                    0,
                    null,
                    null);
            run = runs.saveAndFlush(run);
            final long runId = run.getId();
            if (idemKey != null) {
                idempotencyKeys.putIfAbsent(idemKey, runId);
            }
            // Defer submission until the row we just saved is actually committed and visible to
            // other sessions — executor.submit(...) hands off to a virtual thread that can start
            // running concurrently, and if it queries before this transaction commits,
            // executeRun's findById sees nothing and silently returns, leaving the run stuck at
            // QUEUED forever (a pre-existing race, not related to any specific feature work).
            if (TransactionSynchronizationManager.isSynchronizationActive()) {
                TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
                    @Override
                    public void afterCommit() {
                        executor.submit(() -> executeRun(projectKey, runId, request));
                    }
                });
            } else {
                executor.submit(() -> executeRun(projectKey, runId, request));
            }
            return run;
        }
    }

    public GenerationRun status(String projectKey, long runId) {
        return requireRun(projectKey, runId);
    }

    public List<GenerationRun> history(String projectKey) {
        long projectId = projectService.requireByKey(projectKey).getId();
        return runs.findByProjectIdOrderByIdDesc(projectId);
    }

    public GenerationRun cancel(String projectKey, long runId) {
        GenerationRun run = requireRun(projectKey, runId);
        RunStatus status = run.getStatus();
        if (status == RunStatus.QUEUED || status == RunStatus.RUNNING) {
            run.setStatus(RunStatus.CANCELLED);
            run.setFinishedAt(Instant.now());
            run = runs.save(run);
            completeRun(runId);
        }
        return run;
    }

    public GenerationRun promote(String projectKey, long runId) {
        GenerationRun run = requireRun(projectKey, runId);
        GenerationTarget target = resolveTarget(run);
        TargetWriter writer = targetWriterSelector.forTarget(projectKey, target);
        writer.promote(runId);
        return run;
    }

    /** Registers an SSE emitter to receive {@code progress} events for a run. */
    public void registerEmitter(long runId, SseEmitter emitter) {
        emittersByRun.compute(runId, (id, emitters) -> {
            List<SseEmitter> list = emitters == null ? new CopyOnWriteArrayList<>() : emitters;
            list.add(emitter);
            return list;
        });
        emitter.onCompletion(() -> removeEmitter(runId, emitter));
        emitter.onTimeout(() -> {
            removeEmitter(runId, emitter);
            emitter.complete();
        });
    }

    /** Drops an emitter that will receive no further events (e.g. subscribed after the run finished). */
    public void unregisterEmitter(long runId, SseEmitter emitter) {
        removeEmitter(runId, emitter);
    }

    // ------------------------------------------------------------------
    // Pipeline execution
    // ------------------------------------------------------------------

    /**
     * Plans a build for {@code request} (M22.2.1): pins the snapshot, resolves the target, chooses the baseline and the
     * base build to carry forward, and plans. The only snapshot → baseline → plan path: a run and a dry run of the same
     * request against the same state plan identically. Reads only; nothing is written or locked.
     */
    public PlannedBuild planFor(String projectKey, GenerationRequest request) {
        Project project = projectService.requireByKey(projectKey);
        long projectId = project.getId();
        GenerationTarget target = resolveTarget(projectId, request.targetId());
        TargetWriter writer = targetWriterSelector.forTarget(projectKey, target);
        Snapshot snapshot = snapshotService.snapshot(projectId, request.revision());
        // Channel settings are live configuration (not revision-pinned), read once per run.
        OutputPathResolver paths = OutputPathResolver.forSnapshot(snapshot, channelService.outputSettings(projectId));
        Set<String> channels = BuildPlanner.effectiveChannels(request.channels());
        Set<UUID> scopeAssets = scopeAssets(request);
        GenerationMode mode = request.mode() == null ? GenerationMode.FULL : request.mode();

        long baseRunId = -1;
        BuildManifest base = null;
        Baseline baseline = null;
        FallbackCause fallback = null;
        if (mode == GenerationMode.INCREMENTAL) {
            BaselineChoice choice = baselineFor(projectId, writer, channels, snapshot);
            baseline = choice.baseline();
            fallback = choice.fallbackCause();
            if (baseline != null) {
                baseRunId = choice.runId();
                base = baseline.manifest();
            }
        }
        PlanRequest planRequest = new PlanRequest(mode, baseline, fallback, channels, request.folderPath(), scopeAssets);
        if (base == null && planRequest.scoped()) {
            // A scoped run publishes on top of whatever the target serves now, complete or not.
            long current = writer.currentRunId();
            Optional<BuildManifest> manifest = writer.readManifest(current);
            if (manifest.isPresent()) {
                baseRunId = current;
                base = manifest.get();
            }
        }
        BuildPlan plan = buildPlanner.plan(snapshot, planRequest, paths);
        return new PlannedBuild(project, target, writer, snapshot, paths, channels, baseRunId, base, plan);
    }

    /**
     * A planned build explained without running it (M22.2.1).
     *
     * @param diagnostics the VALIDATE findings grouped by code, like a run's diagnostics; {@code null} unless requested
     */
    public record DryRun(PlannedBuild build, ObjectNode summary, List<PlanEntryRecord> entries, JsonNode diagnostics) {}

    /**
     * Plans {@code request} exactly as a run started now would, and explains the plan (M22.2.1). Nothing is rendered,
     * written, stored or locked: no run row, no plan rows, no SSE, no idempotency key, so it works while a run is active.
     *
     * @param validate also compile every template the plan needs and return the findings (never renders)
     */
    public DryRun dryRun(String projectKey, GenerationRequest request, boolean validate) {
        PlannedBuild build = planFor(projectKey, request);
        List<PlanEntryRecord> entries = PlanInsight.entries(build.snapshot(), build.plan());
        JsonNode diagnostics = validate
                ? diagnosticsJson(renderPipeline.validate(build.snapshot(), build.plan()), List.of())
                : null;
        return new DryRun(build, PlanInsight.summary(mapper, build, request, entries), entries, diagnostics);
    }

    /**
     * A past run's stored plan (M22.1.2).
     *
     * @param target the run's target; {@code null} when it was deleted since
     * @param entries the requested page of entries; {@code null} when retention pruned them
     */
    public record StoredPlan(GenerationRun run, GenerationTarget target, JsonNode summary, Page<PlanEntryRecord> entries) {}

    /**
     * The stored plan of run {@code runId} of the project.
     *
     * @throws SfException 404 when the run belongs to another project or never got past PLAN
     */
    public StoredPlan storedPlan(String projectKey, long runId, PlanEntryRecord.Filter filter, Pageable pageable) {
        GenerationRun run = requireRun(projectKey, runId);
        JsonNode summary = run.getPlanSummary();
        if (summary == null) {
            throw new SfException(ProblemFactory.notFound("No plan is stored for this generation run."));
        }
        GenerationTarget target = run.getTargetId() == null
                ? null
                : targets.findById(run.getTargetId()).filter(t -> t.getProjectId() == run.getProjectId()).orElse(null);
        Page<PlanEntryRecord> entries = RunPlanStore.available(summary) ? runPlanStore.entries(runId, filter, pageable) : null;
        return new StoredPlan(run, target, summary, entries);
    }

    /** The baseline an incremental build of a target uses, or why it has none. */
    record BaselineChoice(long runId, Baseline baseline, FallbackCause fallbackCause) {

        static BaselineChoice none(FallbackCause cause) {
            return new BaselineChoice(-1, null, cause);
        }
    }

    /**
     * The incremental baseline of a target (M22.4.1): the build the target currently serves — the last published or the
     * promoted one — when its manifest shows it holds the whole site in every requested channel. Changes are counted
     * from its consistent revision, so a scoped build (which keeps its base's consistent revision) never advances the
     * baseline, and a build of another target never counts. Without such a build the request plans FULL, with the
     * reason.
     */
    BaselineChoice baselineFor(long projectId, TargetWriter writer, Set<String> channels, Snapshot snapshot) {
        long current = writer.currentRunId();
        if (current < 0) {
            return BaselineChoice.none(FallbackCause.NO_COMPLETE_BUILD_FOR_TARGET);
        }
        Optional<BuildManifest> manifest = writer.readManifest(current);
        if (manifest.isEmpty()) {
            return BaselineChoice.none(FallbackCause.BASE_BUILD_MISSING);
        }
        if (!manifest.get().completeFor(channels)) {
            return BaselineChoice.none(FallbackCause.NO_COMPLETE_BUILD_FOR_TARGET);
        }
        long revision = manifest.get().consistentRevision();
        if (snapshot.revision() < revision) {
            return BaselineChoice.none(FallbackCause.REVISION_BEFORE_BASELINE);
        }
        // A channel output-settings change moves every page of that channel, which the incremental expansion (asset
        // changes over references) cannot see: build FULL instead.
        if (channelService.outputSettingsChangedSince(projectId, revision)) {
            return BaselineChoice.none(FallbackCause.CHANNEL_SETTINGS_CHANGED);
        }
        return new BaselineChoice(current, new Baseline(revision, manifest.get()), null);
    }

    private void executeRun(String projectKey, long runId, GenerationRequest request) {
        GenerationRun run = runs.findById(runId).orElse(null);
        if (run == null) {
            return;
        }
        Timer generationTimer = meterRegistry.timer("sf.generation.duration", "mode", run.getMode().name());
        Timer.Sample sample = Timer.start(meterRegistry);
        try {
            run.setStatus(RunStatus.RUNNING);
            run.setStartedAt(Instant.now());
            runs.save(run);
            emit(runId, STAGE_SNAPSHOT, "Snapshotting assets", 0, 0, 0, null);

            GenerationRequest planned = runRequest(run, request);
            PlannedBuild build = planFor(projectKey, planned);
            Snapshot snapshot = build.snapshot();
            BuildPlan plan = build.plan();
            // The plan is stored before anything renders: a run that fails later is still explainable.
            List<PlanEntryRecord> planEntries = PlanInsight.entries(snapshot, plan);
            run.setRevisionId(snapshot.revision());
            run.setTargetId(build.target().getId());
            run.setPlanSummary(PlanInsight.summary(mapper, build, planned, planEntries));
            run = runs.save(run);
            runPlanStore.save(runId, planEntries);
            emit(runId, STAGE_PLAN, "Planning build", 0, 0, 0, null);

            emit(runId, STAGE_VALIDATE, "Validating templates", 0, 0, 0, null);
            List<Diagnostic> validateErrors = renderPipeline.validate(snapshot, plan);
            if (!validateErrors.isEmpty()) {
                fail(run, sample, generationTimer, validateErrors, List.of(), null);
                return;
            }

            emit(runId, STAGE_RENDER, "Rendering pages", 0, 0, 0, null);
            RenderOutcome outcome = renderPipeline.execute(snapshot, plan, build.paths(), run.getStartedBy());
            if (!outcome.errors().isEmpty()) {
                fail(run, sample, generationTimer, outcome.errors(), outcome.warnings(), null);
                return;
            }

            emit(runId, STAGE_ASSETS, "Copying media", 0, 0, 0, null);
            Set<UUID> media = mediaUuids(outcome, snapshot);
            media.addAll(plan.processedMedia());
            AssetCopyResult assets = assetCopyStage.copy(
                    snapshot, media, mediaRenderStage.open(snapshot, build.paths(), run.getStartedBy()));
            List<Diagnostic> warnings = new ArrayList<>(outcome.warnings());
            warnings.addAll(assets.warnings());
            List<Diagnostic> fileErrors = new ArrayList<>(outcome.pageErrors());
            fileErrors.addAll(assets.fileErrors());

            List<OutputFile> allFiles = new ArrayList<>();
            for (RenderedFile file : outcome.files()) {
                allFiles.add(file.toOutputFile());
            }
            allFiles.addAll(assets.files());

            emit(runId, STAGE_POST, "Post-processing", allFiles.size(), 0, warnings.size(), null);
            TargetWriter writer = build.writer();
            CarryForward carry = new CarryForward(
                    snapshot,
                    plan,
                    build.channels(),
                    request.folderPath(),
                    scopeAssets(request),
                    build.base(),
                    build.carries() ? writer.readFile(build.baseRunId(), SEARCH_INDEX_PATH) : Optional.empty());
            List<String> channels = request.channels() == null ? parseChannels(run.getChannels()) : request.channels();
            PostProcessContext ctx = new PostProcessContext(
                    build.project().getId(), projectKey, baseUrl(build.target()), channels, carry.sitePages(),
                    carry.carriedText());
            allFiles = postProcessStage.apply(ctx, allFiles);

            emit(runId, STAGE_WRITE, "Writing output", allFiles.size(), 0, warnings.size(), null);
            CarryForward.Publication publication = carry.publication(runId, allFiles, outcome.files(), assets);
            if (build.carries()) {
                writer.stage(runId, build.baseRunId(), publication.files(), publication.removedPaths());
            } else {
                writer.stage(runId, publication.files());
            }
            writer.writeManifest(runId, publication.manifest());
            writer.publish(runId);

            long bytes = allFiles.stream().mapToLong(f -> f.bytes().length).sum();
            // A page or processed media file held back makes the run PARTIAL; the rest is published.
            boolean partial = !warnings.isEmpty() || !fileErrors.isEmpty();
            run.setStatus(partial ? RunStatus.PARTIAL : RunStatus.SUCCESS);
            run.setFilesWritten(allFiles.size());
            run.setFilesSkipped(assets.filesSkipped());
            run.setBytesWritten(bytes);
            run.setErrorCount(fileErrors.size());
            run.setWarningCount(warnings.size());
            run.setDiagnostics(diagnosticsJson(fileErrors, warnings));
            run.setFinishedAt(Instant.now());
            runs.save(run);

            emit(runId, STAGE_REPORT, run.getStatus().name(), allFiles.size(), run.getErrorCount(), run.getWarningCount(),
                    run.getDiagnostics());

            completeRun(runId);
            prunePlans(run.getProjectId());
            sample.stop(generationTimer);
            meterRegistry.counter("sf.generation.files", "mode", run.getMode().name()).increment(allFiles.size());
        } catch (Exception e) {
            fail(run, sample, generationTimer, List.of(), List.of(), e);
        }
    }

    /** The request as the queued run recorded it: its revision, mode, target and channels. */
    private GenerationRequest runRequest(GenerationRun run, GenerationRequest request) {
        List<String> channels = request.channels() == null ? parseChannels(run.getChannels()) : request.channels();
        return new GenerationRequest(
                run.getMode(),
                run.getRevisionId(),
                channels,
                run.getTargetId(),
                request.folderPath(),
                request.assetUuids(),
                request.comment(),
                request.idempotencyKey());
    }

    private static Set<UUID> scopeAssets(GenerationRequest request) {
        return request.assetUuids() == null || request.assetUuids().isEmpty() ? null : Set.copyOf(request.assetUuids());
    }

    /** Marks a run FAILED with the given findings (or an unexpected exception) and closes emitters. */
    private void fail(GenerationRun run, Timer.Sample sample, Timer timer, List<Diagnostic> errors,
            List<Diagnostic> warnings, Exception unexpected) {
        sample.stop(timer);
        List<Diagnostic> effectiveErrors = new ArrayList<>(errors);
        if (unexpected instanceof SfException problem && problem.getProblem().getExtensions().get("code") instanceof String code) {
            // A build failure the pipeline reports as a problem (an output path collision, SF-GEN-0110) keeps its code
            // and detail, so the report names what collided rather than just the problem's title.
            String detail = problem.getProblem().getDetail();
            effectiveErrors.add(Diagnostic.error(code, detail == null ? problem.getMessage() : detail, 0, 0));
        } else if (unexpected != null) {
            String message = unexpected.getMessage() == null
                    ? unexpected.getClass().getSimpleName()
                    : unexpected.getMessage();
            effectiveErrors.add(Diagnostic.error(UNEXPECTED_CODE, message, 0, 0));
        }
        run.setStatus(RunStatus.FAILED);
        run.setErrorCount(effectiveErrors.size());
        run.setWarningCount(warnings.size());
        run.setDiagnostics(diagnosticsJson(effectiveErrors, warnings));
        run.setFinishedAt(Instant.now());
        runs.save(run);
        emit(
                run.getId(),
                STAGE_REPORT,
                run.getStatus().name(),
                run.getFilesWritten(),
                run.getErrorCount(),
                run.getWarningCount(),
                run.getDiagnostics());
        completeRun(run.getId());
        prunePlans(run.getProjectId());
    }

    /** Applies plan retention (M22.1.2) after a run; a failure to prune never fails the run. */
    private void prunePlans(long projectId) {
        try {
            runPlanStore.prune(projectId, properties.getPlanRetentionRuns());
        } catch (RuntimeException e) {
            log.warn("Pruning stored plans of project {} failed", projectId, e);
        }
    }

    // ------------------------------------------------------------------
    // Helpers
    // ------------------------------------------------------------------

    private GenerationRun requireRun(String projectKey, long runId) {
        long projectId = projectService.requireByKey(projectKey).getId();
        return runs.findById(runId)
                .filter(run -> run.getProjectId() == projectId)
                .orElseThrow(() -> new SfException(ProblemFactory.notFound("Generation run not found.")));
    }

    private GenerationTarget resolveTarget(GenerationRun run) {
        return resolveTarget(run.getProjectId(), run.getTargetId());
    }

    /** The target {@code targetId} of the project, or the project's default target when {@code null}. */
    private GenerationTarget resolveTarget(long projectId, Long targetId) {
        if (targetId != null) {
            return targets.findById(targetId)
                    .filter(target -> target.getProjectId() == projectId)
                    .orElseThrow(() -> new SfException(
                            ProblemFactory.other(422, NO_TARGET_CODE, "Validation Failed", "Generation target not found.")));
        }
        return targets.findByProjectIdAndDefaultTargetTrue(projectId)
                .or(() -> targets.findByProjectId(projectId).stream().findFirst())
                .orElseThrow(() -> new SfException(ProblemFactory.other(
                        422, NO_TARGET_CODE, "Validation Failed", "No generation target configured.")));
    }

    private static Set<UUID> mediaUuids(RenderOutcome outcome, Snapshot snapshot) {
        Set<UUID> media = new LinkedHashSet<>();
        for (RenderedFile file : outcome.files()) {
            for (UUID uuid : file.dependencies()) {
                SnapshotAsset asset = snapshot.assetByUuid(uuid);
                if (asset != null && asset.type() == AssetType.MEDIA) {
                    media.add(uuid);
                }
            }
        }
        return media;
    }

    private static String baseUrl(GenerationTarget target) {
        JsonNode config = target.getConfig();
        if (config == null || !config.path("baseUrl").isTextual()) {
            return "";
        }
        return config.path("baseUrl").asText();
    }

    private String channelsJson(List<String> channels) {
        if (channels == null || channels.isEmpty()) {
            return null;
        }
        try {
            return mapper.writeValueAsString(channels);
        } catch (JsonProcessingException e) {
            return null;
        }
    }

    private List<String> parseChannels(String json) {
        if (json == null || json.isBlank()) {
            return List.of();
        }
        try {
            JsonNode node = mapper.readTree(json);
            if (node.isArray()) {
                List<String> out = new ArrayList<>();
                for (JsonNode child : node) {
                    if (child.isTextual()) {
                        out.add(child.asText());
                    }
                }
                return out;
            }
        } catch (JsonProcessingException ignored) {
            // fall through
        }
        return List.of();
    }

    private JsonNode diagnosticsJson(List<Diagnostic> errors, List<Diagnostic> warnings) {
        ObjectNode root = mapper.createObjectNode();
        root.set("errors", groupByCode(errors));
        root.set("warnings", groupByCode(warnings));
        return root;
    }

    private ArrayNode groupByCode(List<Diagnostic> diagnostics) {
        Map<String, List<String>> byCode = new LinkedHashMap<>();
        for (Diagnostic diagnostic : diagnostics) {
            byCode.computeIfAbsent(diagnostic.code(), k -> new ArrayList<>()).add(diagnostic.message());
        }
        ArrayNode array = mapper.createArrayNode();
        byCode.forEach((code, messages) -> {
            ObjectNode entry = array.addObject();
            entry.put("code", code);
            entry.put("count", messages.size());
            ArrayNode messagesNode = entry.putArray("messages");
            messages.forEach(messagesNode::add);
        });
        return array;
    }

    private void emit(long runId, String stage, String message, long filesWritten, int errors, int warnings,
            JsonNode diagnostics) {
        List<SseEmitter> emitters = emittersByRun.get(runId);
        if (emitters == null || emitters.isEmpty()) {
            return;
        }
        JsonNode data = mapper.valueToTree(new RunEvent(stage, message, filesWritten, errors, warnings, diagnostics));
        for (SseEmitter emitter : emitters) {
            try {
                emitter.send(SseEmitter.event().name("progress").data(data));
            } catch (Exception e) {
                removeEmitter(runId, emitter);
                emitter.completeWithError(e);
            }
        }
    }

    private void completeRun(long runId) {
        List<SseEmitter> emitters = emittersByRun.remove(runId);
        if (emitters != null) {
            emitters.forEach(SseEmitter::complete);
        }
    }

    private void removeEmitter(long runId, SseEmitter emitter) {
        emittersByRun.computeIfPresent(runId, (id, emitters) -> {
            emitters.remove(emitter);
            return emitters.isEmpty() ? null : emitters;
        });
    }

    private static String trimmed(String value) {
        return value == null || value.isBlank() ? null : value.trim();
    }
}
