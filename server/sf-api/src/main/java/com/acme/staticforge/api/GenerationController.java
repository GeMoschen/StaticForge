package com.acme.staticforge.api;

import com.acme.staticforge.api.dto.GenerationPlanView;
import com.acme.staticforge.api.dto.GenerationRequestDto;
import com.acme.staticforge.api.dto.GenerationRunView;
import com.acme.staticforge.common.ProblemFactory;
import com.acme.staticforge.common.SfException;
import com.acme.staticforge.generate.GenerationMode;
import com.acme.staticforge.generate.GenerationRequest;
import com.acme.staticforge.generate.GenerationRun;
import com.acme.staticforge.generate.GenerationService;
import com.acme.staticforge.generate.insight.PlanEntryRecord;
import com.acme.staticforge.security.SecuritySupport;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.net.URI;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.List;
import org.springframework.data.domain.Page;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

/**
 * Generation-run endpoints (spec §20.2). Thin controller: authorizes, maps DTOs, and delegates
 * to {@link GenerationService}. {@code GET /{runId}/events} streams progress over SSE with
 * single-node affinity (§26.2) — the emitter registry is in-memory, so a project's runs and SSE
 * subscriptions must land on the same instance.
 */
@RestController
@RequestMapping("/api/v1/projects/{projectKey}/generations")
public class GenerationController {

    private static final long SSE_TIMEOUT_MILLIS = 30L * 60 * 1000;

    private final GenerationService generationService;
    private final SecuritySupport securitySupport;
    private final ObjectMapper mapper;

    public GenerationController(
            GenerationService generationService, SecuritySupport securitySupport, ObjectMapper mapper) {
        this.generationService = generationService;
        this.securitySupport = securitySupport;
        this.mapper = mapper;
    }

    @GetMapping
    @PreAuthorize("@projectAuth.has(#projectKey, " + ProjectRoleExpr.VIEWER + ")")
    public List<GenerationRunView> history(@PathVariable String projectKey) {
        return generationService.history(projectKey).stream().map(this::toView).toList();
    }

    @PostMapping
    @PreAuthorize("@projectAuth.has(#projectKey, " + ProjectRoleExpr.DEVELOPER + ")")
    public ResponseEntity<GenerationRunView> start(
            @PathVariable String projectKey,
            @RequestHeader(value = "Idempotency-Key", required = false) String idempotencyKey,
            @RequestBody GenerationRequestDto body) {
        GenerationRun run = generationService.start(projectKey, toRequest(body, idempotencyKey),
                securitySupport.currentUserId());
        return ResponseEntity.accepted()
                .location(location(projectKey, run.getId()))
                .body(toView(run));
    }

    /**
     * Dry run (M22.2.1): the plan a run started now with the same request would build, with every entry's reason. Nothing
     * is rendered, written, stored or locked, so it also works while a run is active.
     */
    @PostMapping("/plan")
    @PreAuthorize("@projectAuth.has(#projectKey, " + ProjectRoleExpr.DEVELOPER + ")")
    public GenerationPlanView plan(
            @PathVariable String projectKey,
            @RequestBody GenerationRequestDto body,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "50") int size,
            @RequestParam(required = false) String rootKind,
            @RequestParam(required = false) String channel,
            @RequestParam(required = false) String q,
            @RequestParam(defaultValue = "false") boolean validate) {
        GenerationService.DryRun dryRun = generationService.dryRun(projectKey, toRequest(body, null), validate);
        Page<PlanEntryRecord> entries =
                PlanViews.page(dryRun.entries(), PlanViews.filter(rootKind, channel, q), PlanViews.pageable(page, size));
        return new GenerationPlanView(
                null,
                new GenerationPlanView.TargetRef(dryRun.build().target().getId(), dryRun.build().target().getName()),
                PlanViews.summary(dryRun.summary()),
                PlanViews.changedAssets(dryRun.summary()),
                PlanViews.entries(entries),
                dryRun.diagnostics());
    }

    /** The stored plan of a past run (M22.2.1); {@code entries} is {@code null} once retention pruned them. */
    @GetMapping("/{runId}/plan")
    @PreAuthorize("@projectAuth.has(#projectKey, " + ProjectRoleExpr.VIEWER + ")")
    public GenerationPlanView storedPlan(
            @PathVariable String projectKey,
            @PathVariable long runId,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "50") int size,
            @RequestParam(required = false) String rootKind,
            @RequestParam(required = false) String channel,
            @RequestParam(required = false) String q) {
        GenerationService.StoredPlan stored = generationService.storedPlan(
                projectKey, runId, PlanViews.filter(rootKind, channel, q), PlanViews.pageable(page, size));
        return new GenerationPlanView(
                runId,
                stored.target() == null
                        ? new GenerationPlanView.TargetRef(stored.run().getTargetId(), null)
                        : new GenerationPlanView.TargetRef(stored.target().getId(), stored.target().getName()),
                PlanViews.summary(stored.summary()),
                PlanViews.changedAssets(stored.summary()),
                stored.entries() == null ? null : PlanViews.entries(stored.entries()),
                null);
    }

    @GetMapping("/{runId}")
    @PreAuthorize("@projectAuth.has(#projectKey, " + ProjectRoleExpr.VIEWER + ")")
    public GenerationRunView status(@PathVariable String projectKey, @PathVariable long runId) {
        return toView(generationService.status(projectKey, runId));
    }

    @PostMapping("/{runId}/cancel")
    @PreAuthorize("@projectAuth.has(#projectKey, " + ProjectRoleExpr.DEVELOPER + ")")
    public GenerationRunView cancel(@PathVariable String projectKey, @PathVariable long runId) {
        return toView(generationService.cancel(projectKey, runId));
    }

    @PostMapping("/{runId}/promote")
    @PreAuthorize("@projectAuth.has(#projectKey, " + ProjectRoleExpr.DEVELOPER + ")")
    public GenerationRunView promote(@PathVariable String projectKey, @PathVariable long runId) {
        return toView(generationService.promote(projectKey, runId));
    }

    @GetMapping("/{runId}/events")
    @PreAuthorize("@projectAuth.has(#projectKey, " + ProjectRoleExpr.VIEWER + ")")
    public SseEmitter events(@PathVariable String projectKey, @PathVariable long runId) {
        generationService.status(projectKey, runId); // 404 before registering anything
        SseEmitter emitter = new SseEmitter(SSE_TIMEOUT_MILLIS);
        // Register before reading the status: a run finishing in between then either reaches this
        // emitter through the normal completion path or is seen as terminal below.
        generationService.registerEmitter(runId, emitter);
        GenerationRun run = generationService.status(projectKey, runId);
        emitCurrent(run, emitter);
        if (run.getStatus().isTerminal()) {
            // Already finished (fast failures often are): no further events will come, so close the
            // stream after the final status instead of leaving the client waiting until timeout.
            generationService.unregisterEmitter(runId, emitter);
            emitter.complete();
        }
        return emitter;
    }

    /** Sends the current run status immediately upon subscription. */
    private void emitCurrent(GenerationRun run, SseEmitter emitter) {
        ObjectNode data = mapper.createObjectNode();
        data.put("stage", "STATUS");
        data.put("message", run.getStatus().name());
        data.put("filesWritten", run.getFilesWritten());
        data.put("errors", run.getErrorCount());
        data.put("warnings", run.getWarningCount());
        data.set("diagnostics", run.getDiagnostics());
        try {
            emitter.send(SseEmitter.event().name("progress").data(data));
        } catch (Exception e) {
            emitter.completeWithError(e);
        }
    }

    private static GenerationRequest toRequest(GenerationRequestDto body, String idempotencyKey) {
        return new GenerationRequest(
                body.mode() == null ? GenerationMode.FULL : body.mode(),
                body.revision(),
                body.channels(),
                body.targetId(),
                body.folderPath(),
                body.assetUuids(),
                body.comment(),
                idempotencyKey);
    }

    private GenerationRunView toView(GenerationRun run) {
        return new GenerationRunView(
                run.getId(),
                run.getRevisionId(),
                run.getMode().name(),
                parseChannels(run.getChannels()),
                run.getTargetId(),
                run.getStatus().name(),
                run.getStartedAt(),
                run.getFinishedAt(),
                run.getFilesWritten(),
                run.getFilesSkipped(),
                run.getBytesWritten(),
                run.getErrorCount(),
                run.getWarningCount(),
                run.getDiagnostics(),
                PlanViews.summary(run.getPlanSummary()));
    }

    private List<String> parseChannels(String json) {
        if (json == null || json.isBlank()) {
            return List.of();
        }
        try {
            return mapper.readValue(
                    json, mapper.getTypeFactory().constructCollectionType(List.class, String.class));
        } catch (JsonProcessingException e) {
            throw new SfException(ProblemFactory.other(
                    500, "SF-GEN-0503", "Internal Server Error", "Failed to decode run channels."));
        }
    }

    private static URI location(String projectKey, Long runId) {
        return URI.create("/api/v1/projects/" + URLEncoder.encode(projectKey, StandardCharsets.UTF_8)
                + "/generations/" + runId);
    }
}
