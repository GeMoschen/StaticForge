package com.acme.staticforge.generate;

import com.acme.staticforge.asset.AssetType;
import com.acme.staticforge.audit.AuditService;
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
import com.acme.staticforge.generate.quality.EffectiveQualityConfig;
import com.acme.staticforge.generate.quality.QualityCheckStage;
import com.acme.staticforge.generate.quality.QualityRuleConfigService;
import com.acme.staticforge.generate.quality.QualitySidecar;
import com.acme.staticforge.generate.quality.RunFindingStore;
import com.acme.staticforge.generate.pipeline.OutputFile;
import com.acme.staticforge.generate.pipeline.RenderedFile;
import com.acme.staticforge.generate.pipeline.RunAbortedException;
import com.acme.staticforge.generate.render.MediaOutputs;
import com.acme.staticforge.generate.render.OutputPathResolver;
import com.acme.staticforge.generate.render.RenderOutcome;
import com.acme.staticforge.generate.render.RenderPipeline;
import com.acme.staticforge.generate.snapshot.Snapshot;
import com.acme.staticforge.generate.snapshot.SnapshotAsset;
import com.acme.staticforge.generate.snapshot.SnapshotView;
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
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.function.Predicate;
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
 *
 * <p><b>Interrupts and cancel (M29.2.1).</b> A run records the node that executes it and a heartbeat
 * ({@link GenerationRunControl}); the {@code generation-run-recovery} job fails runs nothing executes any more
 * ({@link #interrupt}, {@code SF-GEN-0504}). Cancel is real: the executor checks between stages and before each page,
 * and every status change of an active run — the final one together with its publish — happens on the locked row
 * while the run is still in the expected state, so a cancelled or recovered run is never overwritten and never
 * published after {@code CANCELLED} committed.
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
    /** The quality checks over the rendered output (M30.1.3), between ASSETS and POST. */
    static final String STAGE_CHECK = "CHECK";
    static final String STAGE_POST = "POST";
    static final String STAGE_WRITE = "WRITE";
    static final String STAGE_REPORT = "REPORT";

    private static final long SSE_TIMEOUT_MILLIS = 30L * 60 * 1000;
    private static final String CONFLICT_CODE = "SF-GEN-0500";
    private static final String NO_TARGET_CODE = "SF-GEN-0502";
    private static final String UNEXPECTED_CODE = "SF-GEN-0501";
    private static final String SEARCH_INDEX_PATH = "search-index.json";
    /** A run the recovery job failed: its node restarted or its heartbeat stopped (M29.2.1). */
    public static final String INTERRUPTED_CODE = "SF-GEN-0504";
    static final String INTERRUPTED_MESSAGE = "Run interrupted (node restart or lost heartbeat)";
    /** Promote of a run that was never published to its target (M29.2.2). */
    public static final String NOT_PROMOTABLE_CODE = "SF-GEN-0505";

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
    private final Map<String, IdempotentStart> idempotencyKeys = new ConcurrentHashMap<>();
    private final Map<Long, List<SseEmitter>> emittersByRun = new ConcurrentHashMap<>();

    private final com.acme.staticforge.project.ProjectLocales projectLocales;
    private final AuditService audit;
    private final GenerationRunControl control;
    private final QualityCheckStage qualityCheckStage;
    private final QualityRuleConfigService qualityConfig;
    private final RunFindingStore findingStore;

    /** A remembered {@code Idempotency-Key}: the run it started and when (M29.2.4). */
    private record IdempotentStart(long runId, Instant at) {}

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
            MeterRegistry meterRegistry,
            com.acme.staticforge.project.ProjectLocales projectLocales,
            AuditService audit,
            GenerationRunControl control,
            QualityCheckStage qualityCheckStage,
            QualityRuleConfigService qualityConfig,
            RunFindingStore findingStore) {
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
        this.projectLocales = projectLocales;
        this.audit = audit;
        this.control = control;
        this.qualityCheckStage = qualityCheckStage;
        this.qualityConfig = qualityConfig;
        this.findingStore = findingStore;
    }

    /**
     * Queues a generation run (spec §18.5, §20.1). Enforces one active run per project and
     * idempotent re-submission by {@code Idempotency-Key}, then submits the run to the executor.
     *
     * <p>An archived project starts no run and promotes none ({@code 409 SF-DOM-0141}, M26); a run already queued or
     * running when the project was archived is allowed to finish, and can still be cancelled.
     *
     * <p>Who may start which run is decided before this call ({@code GenerationAuthorization}, M28.2.2). The start is
     * audited ({@code GENERATION_STARTED}) as {@code userId}. An {@code Idempotency-Key} is scoped by project and
     * user: another user reusing a key starts their own run instead of receiving someone else's.
     */
    @Transactional
    public GenerationRun start(String projectKey, GenerationRequest request, Long userId) {
        return start(projectKey, request, userId, null);
    }

    /** As {@link #start(String, GenerationRequest, Long)} for a scheduled action, named in the audit entry. */
    @Transactional
    public GenerationRun start(String projectKey, GenerationRequest request, Long userId, Long scheduledActionId) {
        synchronized (startLock) {
            String requestKey = trimmed(request.idempotencyKey());
            String idemKey = requestKey == null
                    ? null
                    : projectService.requireByKey(projectKey).getId() + ":" + userId + ":" + requestKey;
            if (idemKey != null) {
                IdempotentStart previous = idempotencyKeys.get(idemKey);
                if (previous != null) {
                    return runs.findById(previous.runId()).orElse(null);
                }
            }

            long projectId = projectService.requireWritable(projectKey).getId();
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
            run.setComment(request.comment());
            run.setExecutorNode(control.nodeId());
            run = runs.saveAndFlush(run);
            final long runId = run.getId();
            // Held before the row commits: the recovery job never sees this node's queued run without its executor.
            control.hold(runId, projectId);
            audit.record(projectId, userId, "GENERATION_STARTED", "generation:" + runId,
                    startDetail(run, request, scheduledActionId));
            if (idemKey != null) {
                idempotencyKeys.putIfAbsent(idemKey, new IdempotentStart(runId, Instant.now()));
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

                    @Override
                    public void afterCompletion(int status) {
                        if (status != STATUS_COMMITTED) {
                            control.release(runId);
                        }
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

    /**
     * Cancels a queued or running run as {@code actorUserId} (audited {@code GENERATION_CANCELLED}); else a no-op that
     * returns the run as it is (a run that finished meanwhile stays finished). The status is written on the locked row
     * while the run is still active (M29.2.1). Once committed, the run's executor stops at its next checkpoint without
     * publishing, and the event stream gets a final {@code CANCELLED} event.
     */
    @Transactional
    public GenerationRun cancel(String projectKey, long runId, Long actorUserId) {
        GenerationRun run = requireRun(projectKey, runId);
        Optional<GenerationRun> cancelled = control.whileActive(runId, active -> true, active -> {
            active.setStatus(RunStatus.CANCELLED);
            active.setFinishedAt(Instant.now());
        });
        if (cancelled.isEmpty()) {
            return runs.findById(runId).orElse(run);
        }
        GenerationRun done = cancelled.get();
        audit.record(done.getProjectId(), actorUserId, "GENERATION_CANCELLED", "generation:" + runId, runDetail(done));
        afterCommit(() -> {
            control.abort(runId);
            finished(done);
        });
        return done;
    }

    /**
     * Promotes a run's output as {@code actorUserId} (audited {@code GENERATION_PROMOTED}). Only a published build can
     * be promoted (M29.2.2): a run that isn't {@code SUCCESS}/{@code PARTIAL}, never got a target, or whose build is no
     * longer on disk answers {@code 409 SF-GEN-0505}, and {@code current} stays as it is.
     */
    @Transactional
    public GenerationRun promote(String projectKey, long runId, Long actorUserId) {
        projectService.requireWritable(projectKey);
        GenerationRun run = requireRun(projectKey, runId);
        if (run.getStatus() != RunStatus.SUCCESS && run.getStatus() != RunStatus.PARTIAL) {
            throw notPromotable("Run " + runId + " is " + run.getStatus()
                    + "; only a published build (SUCCESS or PARTIAL) can be promoted.");
        }
        if (run.getTargetId() == null) {
            throw notPromotable("Run " + runId + " has no build for any target.");
        }
        GenerationTarget target = resolveTarget(run);
        TargetWriter writer = targetWriterSelector.forTarget(projectKey, target);
        try {
            writer.promote(runId);
        } catch (IllegalStateException e) {
            throw notPromotable("The build of run " + runId + " is no longer on disk.");
        }
        audit.record(run.getProjectId(), actorUserId, "GENERATION_PROMOTED", "generation:" + runId, runDetail(run));
        return run;
    }

    private static SfException notPromotable(String detail) {
        return new SfException(ProblemFactory.other(409, NOT_PROMOTABLE_CODE, "Conflict", detail));
    }

    /**
     * Fails an interrupted run (M29.2.1, the {@code generation-run-recovery} job): when run {@code runId} is still
     * {@code QUEUED}/{@code RUNNING}, not held by this node's executor, and {@code stillInterrupted} holds for its fresh
     * locked state, it becomes {@code FAILED} with {@code SF-GEN-0504}; local event streams get the final event. Its
     * staged output stays for {@code build-output-cleanup}.
     *
     * @return the failed run, or empty when it finished, is executing here, or no longer qualifies
     */
    public Optional<GenerationRun> interrupt(long runId, Predicate<GenerationRun> stillInterrupted) {
        Optional<GenerationRun> failed = control.whileActive(
                runId,
                run -> !control.isHeld(runId) && stillInterrupted.test(run),
                run -> {
                    run.setStatus(RunStatus.FAILED);
                    run.setErrorCount(1);
                    run.setDiagnostics(diagnosticsJson(
                            List.of(Diagnostic.error(INTERRUPTED_CODE, INTERRUPTED_MESSAGE, 0, 0)), List.of()));
                    run.setFinishedAt(Instant.now());
                });
        failed.ifPresent(run -> {
            finished(run);
            prunePlans(run.getProjectId());
        });
        return failed;
    }

    /**
     * Forgets the {@code Idempotency-Key}s remembered before {@code olderThan} (M29.2.4, the {@code memory-eviction}
     * job). A re-submission with a forgotten key starts a new run.
     *
     * @return how many keys were forgotten
     */
    public int evictIdempotencyKeys(Instant olderThan) {
        int before = idempotencyKeys.size();
        idempotencyKeys.values().removeIf(start -> start.at().isBefore(olderThan));
        return Math.max(0, before - idempotencyKeys.size());
    }

    /** How many {@code Idempotency-Key}s are remembered now. */
    public int idempotencyKeyCount() {
        return idempotencyKeys.size();
    }

    /** {@code sf.generate.idempotency-ttl}: how long a key is remembered. */
    public Duration idempotencyTtl() {
        return properties.getIdempotencyTtl();
    }

    private ObjectNode startDetail(GenerationRun run, GenerationRequest request, Long scheduledActionId) {
        ObjectNode detail = runDetail(run);
        detail.put("mode", (request.mode() == null ? GenerationMode.FULL : request.mode()).name());
        ArrayNode channels = detail.putArray("channels");
        if (request.channels() != null) {
            request.channels().forEach(channels::add);
        }
        detail.put("scoped", (request.folderPath() != null && !request.folderPath().isBlank())
                || (request.assetUuids() != null && !request.assetUuids().isEmpty()));
        if (request.revision() == null) {
            detail.putNull("revision");
        } else {
            detail.put("revision", request.revision());
        }
        if (scheduledActionId != null) {
            detail.put("scheduledActionId", scheduledActionId);
        }
        return detail;
    }

    /** {@code {runId, targetId}}; the target as requested, {@code null} for the default. */
    private ObjectNode runDetail(GenerationRun run) {
        ObjectNode detail = mapper.createObjectNode();
        detail.put("runId", run.getId());
        if (run.getTargetId() == null) {
            detail.putNull("targetId");
        } else {
            detail.put("targetId", run.getTargetId());
        }
        return detail;
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
        Snapshot snapshot = snapshotService.snapshot(projectId, request.revision(), SnapshotView.RELEASED);
        // Channel settings are live configuration (not revision-pinned), read once per run.
        OutputPathResolver paths = OutputPathResolver.forSnapshot(
                snapshot, channelService.outputSettings(projectId), projectLocales.forProject(projectId));
        Set<String> channels = BuildPlanner.effectiveChannels(request.channels());
        Set<UUID> scopeAssets = scopeAssets(request);
        GenerationMode mode = request.mode() == null ? GenerationMode.FULL : request.mode();
        EffectiveQualityConfig quality = qualityConfig.effective(projectId);

        long baseRunId = -1;
        BuildManifest base = null;
        Baseline baseline = null;
        FallbackCause fallback = null;
        QualitySidecar baseQuality = null;
        if (mode == GenerationMode.INCREMENTAL) {
            BaselineChoice choice = baselineFor(projectId, writer, channels, snapshot, quality);
            baseline = choice.baseline();
            fallback = choice.fallbackCause();
            if (baseline != null) {
                baseRunId = choice.runId();
                base = baseline.manifest();
                baseQuality = choice.quality();
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
                // A scoped run keeps what the target serves; outputs of a build without facts are simply not checked.
                baseQuality = writer.readSidecar(current, QualitySidecar.NAME).flatMap(QualitySidecar::parse).orElse(null);
            }
        }
        BuildPlan plan = buildPlanner.plan(snapshot, planRequest, paths);
        return new PlannedBuild(
                project, target, writer, snapshot, paths, channels, baseRunId, base, plan, quality, baseQuality);
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
        List<PlanEntryRecord> entries = PlanInsight.entries(build);
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
    record BaselineChoice(long runId, Baseline baseline, FallbackCause fallbackCause, QualitySidecar quality) {

        static BaselineChoice none(FallbackCause cause) {
            return new BaselineChoice(-1, null, cause, null);
        }
    }

    /**
     * The incremental baseline of a target (M22.4.1): the build the target currently serves — the last published or the
     * promoted one — when its manifest shows it holds the whole site in every requested channel. Changes are counted
     * from its consistent revision, so a scoped build (which keeps its base's consistent revision) never advances the
     * baseline, and a build of another target never counts. Without such a build the request plans FULL, with the
     * reason.
     *
     * <p>The baseline also carries the quality check facts of its outputs (M30.1.3): a build without its
     * {@code quality.json} sidecar (published before M30), or one checked under another rule configuration — changed
     * since the baseline, or a rule set that changed with the application — can't vouch for its carried outputs, so the
     * request plans FULL.
     */
    BaselineChoice baselineFor(
            long projectId, TargetWriter writer, Set<String> channels, Snapshot snapshot, EffectiveQualityConfig quality) {
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
        Optional<QualitySidecar> facts = writer.readSidecar(current, QualitySidecar.NAME).flatMap(QualitySidecar::parse);
        if (facts.isEmpty()) {
            return BaselineChoice.none(FallbackCause.BASE_BUILD_WITHOUT_QUALITY_FACTS);
        }
        if (qualityConfig.qualityRulesChangedSince(projectId, revision)
                || !quality.fingerprint().equals(facts.get().configFingerprint())) {
            return BaselineChoice.none(FallbackCause.QUALITY_RULES_CHANGED);
        }
        return new BaselineChoice(current, new Baseline(revision, manifest.get()), null, facts.get());
    }

    private void executeRun(String projectKey, long runId, GenerationRequest request) {
        try {
            executeHeld(projectKey, runId, request);
        } finally {
            control.release(runId);
        }
    }

    /**
     * Runs a held run to its end. Between stages (and before each page) the run stops when it is no longer running
     * ({@link RunAbortedException}); every write of the run happens on its locked row while it is still
     * {@code RUNNING}, and the final one publishes inside that lock, so a cancel or recovery that committed first is
     * never overwritten and the build is then never published (M29.2.1).
     */
    private void executeHeld(String projectKey, long runId, GenerationRequest request) {
        GenerationRun run = runs.findById(runId).orElse(null);
        if (run == null) {
            return;
        }
        if (!control.markRunning(runId)) {
            // Cancelled or recovered while queued: whoever did it wrote the status and told the listeners.
            completeRun(runId);
            return;
        }
        Timer generationTimer = meterRegistry.timer("sf.generation.duration", "mode", run.getMode().name());
        Timer.Sample sample = Timer.start(meterRegistry);
        try {
            control.stage(runId, STAGE_SNAPSHOT);
            emit(runId, STAGE_SNAPSHOT, "Snapshotting assets", 0, 0, 0, null);

            GenerationRequest planned = runRequest(run, request);
            PlannedBuild build = planFor(projectKey, planned);
            Snapshot snapshot = build.snapshot();
            BuildPlan plan = build.plan();
            // The plan is stored before anything renders: a run that fails later is still explainable.
            List<PlanEntryRecord> planEntries = PlanInsight.entries(build);
            JsonNode planSummary = PlanInsight.summary(mapper, build, planned, planEntries);
            run = control.whileRunning(runId, active -> {
                        active.setRevisionId(snapshot.revision());
                        active.setTargetId(build.target().getId());
                        active.setPlanSummary(planSummary);
                    })
                    .orElseThrow(() -> new RunAbortedException(runId));
            runPlanStore.save(runId, planEntries);
            control.stage(runId, STAGE_PLAN);
            emit(runId, STAGE_PLAN, "Planning build", 0, 0, 0, null);

            control.stage(runId, STAGE_VALIDATE);
            emit(runId, STAGE_VALIDATE, "Validating templates", 0, 0, 0, null);
            List<Diagnostic> validateErrors = renderPipeline.validate(snapshot, plan);
            if (!validateErrors.isEmpty()) {
                fail(runId, sample, generationTimer, validateErrors, List.of(), null);
                return;
            }

            control.stage(runId, STAGE_RENDER);
            emit(runId, STAGE_RENDER, "Rendering pages", 0, 0, 0, null);
            RenderOutcome outcome = renderPipeline.execute(snapshot, plan, build.paths(), run.getStartedBy(),
                    () -> control.checkpoint(runId, GenerationRunProbe.RENDER_PAGE));
            if (!outcome.errors().isEmpty()) {
                fail(runId, sample, generationTimer, outcome.errors(), outcome.warnings(), null);
                return;
            }

            control.stage(runId, STAGE_ASSETS);
            emit(runId, STAGE_ASSETS, "Copying media", 0, 0, 0, null);
            com.acme.staticforge.project.LocaleConfig locales =
                    projectLocales.forProject(build.project().getId());
            MediaOutputs mediaOutputs = new MediaOutputs(snapshot, locales);
            AssetCopyResult assets = assetCopyStage.copy(
                    mediaOutputs,
                    mediaReferences(outcome, plan, snapshot),
                    processedOutputs(plan, build.base()),
                    mediaRenderStage.open(snapshot, build.paths(), run.getStartedBy()));
            Map<String, UUID> mediaByPath = new HashMap<>();
            assets.owners().forEach((path, key) -> mediaByPath.put(path, key.media()));
            List<OutputPathResolver.Collision> mediaCollisions =
                    build.paths().findMediaCollisions(plan.siteOutputs(), mediaByPath);
            if (!mediaCollisions.isEmpty()) {
                throw RenderPipeline.collisionError(mediaCollisions);
            }
            List<Diagnostic> warnings = new ArrayList<>(outcome.warnings());
            warnings.addAll(assets.warnings());
            List<Diagnostic> fileErrors = new ArrayList<>(outcome.pageErrors());
            fileErrors.addAll(assets.fileErrors());

            TargetWriter writer = build.writer();
            CarryForward carry = new CarryForward(
                    snapshot,
                    mediaOutputs,
                    plan,
                    build.channels(),
                    request.folderPath(),
                    scopeAssets(request),
                    build.base(),
                    build.carries() ? writer.readFile(build.baseRunId(), SEARCH_INDEX_PATH) : Optional.empty());

            // CHECK (M30.1.3): quality checks over what the run rendered and what it carries; an ERROR holds a page
            // back, and every output planned but not published is withheld from the site pages.
            control.stage(runId, STAGE_CHECK);
            emit(runId, STAGE_CHECK, "Checking output", 0, fileErrors.size(), warnings.size(), null);
            String baseUrl = baseUrl(build.target());
            Set<String> notRendered = notRendered(plan, outcome);
            QualityCheckStage.CheckResult check = qualityCheckStage.check(new QualityCheckStage.CheckInput(
                    build.quality(),
                    baseUrl,
                    locales,
                    build.paths()::settingsFor,
                    snapshot,
                    plan.entries(),
                    outcome.files(),
                    notRendered,
                    carry.carriedPages(),
                    mediaOutputsOf(assets, carry.carriedMedia(outcome.files(), assets)),
                    siteFiles(baseUrl),
                    build.baseQuality(),
                    () -> control.checkpoint(runId, GenerationRunProbe.CHECK_OUTPUT)));
            Set<String> withheld = new LinkedHashSet<>(notRendered);
            withheld.addAll(check.heldBack());
            carry.withhold(withheld);
            fileErrors.addAll(check.pageErrors());
            List<RenderedFile> published = check.published(outcome.files());
            emit(runId, STAGE_CHECK, checkedMessage(check), 0, fileErrors.size(), warnings.size(), null);

            List<OutputFile> allFiles = new ArrayList<>();
            for (RenderedFile file : published) {
                allFiles.add(file.toOutputFile());
            }
            allFiles.addAll(assets.files());

            control.stage(runId, STAGE_POST);
            emit(runId, STAGE_POST, "Post-processing", allFiles.size(), 0, warnings.size(), null);
            List<String> channels = request.channels() == null ? parseChannels(run.getChannels()) : request.channels();
            PostProcessContext ctx = new PostProcessContext(
                    build.project().getId(), projectKey, baseUrl, channels, carry.sitePages(),
                    false, java.util.List.of(), java.util.List.of(), carry.carriedText(),
                    locales.isLocalized() ? locales.defaultLocale() : null);
            List<OutputFile> processed = postProcessStage.apply(ctx, allFiles);

            control.stage(runId, STAGE_WRITE);
            emit(runId, STAGE_WRITE, "Writing output", processed.size(), 0, warnings.size(), null);
            CarryForward.Publication publication = carry.publication(runId, processed, published, assets);
            if (build.carries()) {
                writer.stage(runId, build.baseRunId(), publication.files(), publication.removedPaths());
            } else {
                writer.stage(runId, publication.files());
            }

            control.stage(runId, GenerationRunProbe.PUBLISH);
            long bytes = processed.stream().mapToLong(f -> f.bytes().length).sum();
            // A page or processed media file held back makes the run PARTIAL; the rest is published. Quality findings
            // don't: they are stored apart from the diagnostics (a warning alone leaves the run SUCCESS).
            boolean partial = !warnings.isEmpty() || !fileErrors.isEmpty();
            JsonNode diagnostics = diagnosticsJson(fileErrors, warnings);
            byte[] qualityFacts = check.sidecar().toJson();
            // The manifest marks a published build (M29.2.2): it is written right before the flip, and both happen
            // only while the run is still RUNNING, on its locked row — a cancel that committed first wins. The
            // findings are stored in the same transaction: a run that isn't recorded stores none.
            GenerationRun done = control.whileRunning(runId, active -> {
                        findingStore.save(runId, check.findings()).applyTo(active);
                        writer.writeSidecar(runId, QualitySidecar.NAME, qualityFacts);
                        writer.writeManifest(runId, publication.manifest());
                        writer.publish(runId);
                        active.setStatus(partial ? RunStatus.PARTIAL : RunStatus.SUCCESS);
                        active.setFilesWritten(processed.size());
                        active.setFilesSkipped(assets.filesSkipped());
                        active.setBytesWritten(bytes);
                        active.setErrorCount(fileErrors.size());
                        active.setWarningCount(warnings.size());
                        active.setDiagnostics(diagnostics);
                        active.setFinishedAt(Instant.now());
                    })
                    .orElseThrow(() -> new RunAbortedException(runId));

            finished(done);
            prunePlans(done.getProjectId());
            sample.stop(generationTimer);
            meterRegistry.counter("sf.generation.files", "mode", done.getMode().name()).increment(processed.size());
        } catch (RunAbortedException e) {
            stopped(runId, run.getProjectId());
        } catch (Exception e) {
            fail(runId, sample, generationTimer, List.of(), List.of(), e);
        }
    }

    /** The page outputs the run planned but didn't render: held back before the checks, or with no channel source. */
    private static Set<String> notRendered(BuildPlan plan, RenderOutcome outcome) {
        Set<String> rendered = new java.util.HashSet<>();
        outcome.files().forEach(file -> rendered.add(file.outputPath()));
        Set<String> missing = new LinkedHashSet<>();
        for (com.acme.staticforge.generate.plan.PlanEntry entry : plan.entries()) {
            if (!rendered.contains(entry.outputPath())) {
                missing.add(entry.outputPath());
            }
        }
        return missing;
    }

    /** Every media output of the build: written by the run, and carried from the base build. */
    private static Map<String, MediaOutputs.Key> mediaOutputsOf(
            AssetCopyResult assets, List<BuildManifest.Output> carriedMedia) {
        Map<String, MediaOutputs.Key> media = new LinkedHashMap<>(assets.owners());
        for (BuildManifest.Output output : carriedMedia) {
            media.putIfAbsent(output.path(), new MediaOutputs.Key(output.asset(), output.locale()));
        }
        return media;
    }

    /** The site files post-processing writes for a target with {@code baseUrl} (a link to them is no broken link). */
    private static Set<String> siteFiles(String baseUrl) {
        return baseUrl.isBlank()
                ? Set.of(SEARCH_INDEX_PATH)
                : Set.of(SEARCH_INDEX_PATH, "sitemap.xml", "robots.txt");
    }

    /** The {@code CHECK} stage's closing progress line: how much was checked and found. */
    private static String checkedMessage(QualityCheckStage.CheckResult check) {
        return "Checked " + check.checkedOutputs() + (check.checkedOutputs() == 1 ? " output: " : " outputs: ")
                + check.errorCount() + (check.errorCount() == 1 ? " error, " : " errors, ")
                + check.warningCount() + (check.warningCount() == 1 ? " warning" : " warnings")
                + (check.pageErrors().isEmpty() ? "" : "; " + check.pageErrors().size() + " held back");
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

    /**
     * Marks a running run FAILED with the given findings (or an unexpected exception) and closes emitters. A run that
     * is no longer running (cancelled or recovered meanwhile) keeps its status.
     */
    private void fail(long runId, Timer.Sample sample, Timer timer, List<Diagnostic> errors,
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
        JsonNode diagnostics = diagnosticsJson(effectiveErrors, warnings);
        Optional<GenerationRun> failed;
        try {
            failed = control.whileRunning(runId, run -> {
                run.setStatus(RunStatus.FAILED);
                run.setErrorCount(effectiveErrors.size());
                run.setWarningCount(warnings.size());
                run.setDiagnostics(diagnostics);
                run.setFinishedAt(Instant.now());
            });
        } catch (RuntimeException e) {
            // The database is unreachable: the run stays RUNNING, its heartbeat stops, and recovery fails it later.
            log.error("Could not record the failure of generation run {}", runId, e);
            completeRun(runId);
            return;
        }
        if (failed.isEmpty()) {
            runs.findById(runId).ifPresent(run -> stopped(runId, run.getProjectId()));
            return;
        }
        finished(failed.get());
        prunePlans(failed.get().getProjectId());
    }

    /** The executor lets go of a run someone else ended (cancel or recovery): no status write, no publish. */
    private void stopped(long runId, long projectId) {
        log.info("Generation run {} stopped: it is no longer running (cancelled or interrupted)", runId);
        completeRun(runId);
        prunePlans(projectId);
    }

    /** Sends a finished run's final {@code REPORT} event and closes its event streams. */
    private void finished(GenerationRun run) {
        emit(run.getId(), STAGE_REPORT, run.getStatus().name(), run.getFilesWritten(), run.getErrorCount(),
                run.getWarningCount(), run.getDiagnostics());
        completeRun(run.getId());
    }

    /** Runs {@code action} once the current transaction committed (now, without one). */
    private static void afterCommit(Runnable action) {
        if (TransactionSynchronizationManager.isSynchronizationActive()) {
            TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
                @Override
                public void afterCommit() {
                    action.run();
                }
            });
        } else {
            action.run();
        }
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

    /**
     * The media the rendered pages reference, each from the locale its page rendered in (M27.3.2): a localized media
     * file resolves per locale.
     */
    private static Set<AssetCopyStage.Reference> mediaReferences(RenderOutcome outcome, BuildPlan plan, Snapshot snapshot) {
        Map<String, String> localeByPath = new HashMap<>();
        plan.entries().forEach(entry -> {
            if (entry.locale() != null) {
                localeByPath.put(entry.outputPath(), entry.locale());
            }
        });
        Set<AssetCopyStage.Reference> media = new LinkedHashSet<>();
        for (RenderedFile file : outcome.files()) {
            for (UUID uuid : file.dependencies()) {
                SnapshotAsset asset = snapshot.assetByUuid(uuid);
                if (asset != null && asset.type() == AssetType.MEDIA) {
                    media.add(new AssetCopyStage.Reference(uuid, localeByPath.get(file.outputPath())));
                }
            }
        }
        return media;
    }

    /**
     * The processed media outputs an incremental plan re-renders (M18.3.1): the outputs the base build has of each
     * processed media file the walk reached — one per locale it is written for (M27.3.2). Without a base build every
     * page renders, and their references name the outputs.
     */
    private static List<MediaOutputs.Key> processedOutputs(BuildPlan plan, BuildManifest base) {
        if (base == null || plan.processedMedia().isEmpty()) {
            return List.of();
        }
        Set<MediaOutputs.Key> keys = new LinkedHashSet<>();
        for (BuildManifest.Output output : base.outputs()) {
            if (output.kind() == BuildManifest.Kind.MEDIA && plan.processedMedia().contains(output.asset())) {
                keys.add(new MediaOutputs.Key(output.asset(), output.locale()));
            }
        }
        return List.copyOf(keys);
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
