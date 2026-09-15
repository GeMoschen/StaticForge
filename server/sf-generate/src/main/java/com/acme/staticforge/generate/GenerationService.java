package com.acme.staticforge.generate;

import com.acme.staticforge.asset.AssetType;
import com.acme.staticforge.common.ProblemFactory;
import com.acme.staticforge.common.SfException;
import com.acme.staticforge.generate.plan.BuildPlan;
import com.acme.staticforge.generate.plan.BuildPlanner;
import com.acme.staticforge.generate.plan.PlanEntry;
import com.acme.staticforge.generate.pipeline.OutputFile;
import com.acme.staticforge.generate.pipeline.RenderedFile;
import com.acme.staticforge.generate.postprocess.SitePage;
import com.acme.staticforge.generate.render.OutputPathResolver;
import com.acme.staticforge.generate.render.RenderOutcome;
import com.acme.staticforge.generate.render.RenderPipeline;
import com.acme.staticforge.generate.snapshot.Snapshot;
import com.acme.staticforge.generate.snapshot.SnapshotAsset;
import com.acme.staticforge.generate.snapshot.SnapshotService;
import com.acme.staticforge.generate.stage.AssetCopyResult;
import com.acme.staticforge.generate.stage.AssetCopyStage;
import com.acme.staticforge.generate.stage.PostProcessContext;
import com.acme.staticforge.generate.stage.PostProcessStage;
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
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
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

    private final GenerationRunRepository runs;
    private final GenerationTargetRepository targets;
    private final ProjectService projectService;
    private final SnapshotService snapshotService;
    private final BuildPlanner buildPlanner;
    private final RenderPipeline renderPipeline;
    private final AssetCopyStage assetCopyStage;
    private final PostProcessStage postProcessStage;
    private final TargetWriterSelector targetWriterSelector;
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
            SnapshotService snapshotService,
            BuildPlanner buildPlanner,
            RenderPipeline renderPipeline,
            AssetCopyStage assetCopyStage,
            PostProcessStage postProcessStage,
            TargetWriterSelector targetWriterSelector,
            ObjectMapper mapper,
            MeterRegistry meterRegistry) {
        this.runs = runs;
        this.targets = targets;
        this.projectService = projectService;
        this.snapshotService = snapshotService;
        this.buildPlanner = buildPlanner;
        this.renderPipeline = renderPipeline;
        this.assetCopyStage = assetCopyStage;
        this.postProcessStage = postProcessStage;
        this.targetWriterSelector = targetWriterSelector;
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

    private void executeRun(String projectKey, long runId, GenerationRequest request) {
        GenerationRun run = runs.findById(runId).orElse(null);
        if (run == null) {
            return;
        }
        Timer generationTimer = meterRegistry.timer("sf.generation.duration", "mode", run.getMode().name());
        Timer.Sample sample = Timer.start(meterRegistry);
        try {
            Project project = projectService.requireByKey(projectKey);
            long projectId = project.getId();

            run.setStatus(RunStatus.RUNNING);
            run.setStartedAt(Instant.now());
            runs.save(run);
            emit(runId, STAGE_SNAPSHOT, "Snapshotting assets", 0, 0, 0, null);

            Snapshot snapshot = snapshotService.snapshot(projectId, run.getRevisionId());
            run.setRevisionId(snapshot.revision());
            runs.save(run);

            emit(runId, STAGE_PLAN, "Planning build", 0, 0, 0, null);
            OutputPathResolver paths = OutputPathResolver.forSnapshot(snapshot, "index", false, "DEFAULT");
            Long lastRevision = runs.findRecentSuccesses(projectId).stream()
                    .findFirst()
                    .map(GenerationRun::getRevisionId)
                    .orElse(null);
            GenerationTarget target = resolveTarget(run);
            List<String> channels = request.channels() == null
                    ? parseChannels(run.getChannels())
                    : request.channels();
            BuildPlan plan = buildPlanner.plan(
                    snapshot,
                    run.getMode(),
                    lastRevision,
                    channels == null || channels.isEmpty() ? null : Set.copyOf(channels),
                    request.folderPath(),
                    request.assetUuids() == null || request.assetUuids().isEmpty()
                            ? null
                            : Set.copyOf(request.assetUuids()),
                    paths);

            emit(runId, STAGE_VALIDATE, "Validating templates", 0, 0, 0, null);
            List<Diagnostic> validateErrors = renderPipeline.validate(snapshot, plan);
            if (!validateErrors.isEmpty()) {
                fail(run, sample, generationTimer, validateErrors, List.of(), null);
                return;
            }

            emit(runId, STAGE_RENDER, "Rendering pages", 0, 0, 0, null);
            RenderOutcome outcome = renderPipeline.execute(snapshot, plan, paths, run.getStartedBy());
            if (!outcome.errors().isEmpty()) {
                fail(run, sample, generationTimer, outcome.errors(), outcome.warnings(), null);
                return;
            }

            emit(runId, STAGE_ASSETS, "Copying media", 0, 0, 0, null);
            AssetCopyResult assets = assetCopyStage.copy(snapshot, mediaUuids(outcome, snapshot));

            List<OutputFile> allFiles = new ArrayList<>();
            for (RenderedFile file : outcome.files()) {
                allFiles.add(file.toOutputFile());
            }
            allFiles.addAll(assets.files());

            emit(runId, STAGE_POST, "Post-processing", allFiles.size(), 0, outcome.warnings().size(), null);
            PostProcessContext ctx = new PostProcessContext(
                    projectId, projectKey, baseUrl(target), channels, sitePages(snapshot, plan, channels));
            allFiles = postProcessStage.apply(ctx, allFiles);

            emit(runId, STAGE_WRITE, "Writing output", allFiles.size(), 0, outcome.warnings().size(), null);
            TargetWriter writer = targetWriterSelector.forTarget(projectKey, target);
            writer.stage(runId, allFiles);
            writer.publish(runId);

            long bytes = allFiles.stream().mapToLong(f -> f.bytes().length).sum();
            boolean partial = !outcome.warnings().isEmpty();
            run.setStatus(partial ? RunStatus.PARTIAL : RunStatus.SUCCESS);
            run.setFilesWritten(allFiles.size());
            run.setFilesSkipped(assets.filesSkipped());
            run.setBytesWritten(bytes);
            run.setErrorCount(0);
            run.setWarningCount(outcome.warnings().size());
            run.setDiagnostics(diagnosticsJson(List.of(), outcome.warnings()));
            run.setFinishedAt(Instant.now());
            runs.save(run);

            emit(runId, STAGE_REPORT, run.getStatus().name(), allFiles.size(), 0, run.getWarningCount(), run.getDiagnostics());
            completeRun(runId);
            sample.stop(generationTimer);
            meterRegistry.counter("sf.generation.files", "mode", run.getMode().name()).increment(allFiles.size());
        } catch (Exception e) {
            fail(run, sample, generationTimer, List.of(), List.of(), e);
        }
    }

    /** Marks a run FAILED with the given findings (or an unexpected exception) and closes emitters. */
    private void fail(GenerationRun run, Timer.Sample sample, Timer timer, List<Diagnostic> errors,
            List<Diagnostic> warnings, Exception unexpected) {
        sample.stop(timer);
        List<Diagnostic> effectiveErrors = new ArrayList<>(errors);
        if (unexpected != null) {
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
        if (run.getTargetId() != null) {
            return targets.findById(run.getTargetId())
                    .filter(target -> target.getProjectId() == run.getProjectId())
                    .orElseThrow(() -> new SfException(
                            ProblemFactory.other(422, NO_TARGET_CODE, "Validation Failed", "Generation target not found.")));
        }
        return targets.findByProjectIdAndDefaultTargetTrue(run.getProjectId())
                .or(() -> targets.findByProjectId(run.getProjectId()).stream().findFirst())
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

    private static List<SitePage> sitePages(Snapshot snapshot, BuildPlan plan, List<String> channels) {
        List<SitePage> pages = new ArrayList<>();
        for (PlanEntry entry : plan.entries()) {
            SnapshotAsset page = snapshot.assetByUuid(entry.pageUuid());
            if (page == null) {
                continue;
            }
            pages.add(new SitePage(page.uid(), entry.outputPath(), entry.channel(), page.displayName()));
        }
        return pages;
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
