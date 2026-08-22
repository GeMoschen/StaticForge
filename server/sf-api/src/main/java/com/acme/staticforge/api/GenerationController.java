package com.acme.staticforge.api;

import com.acme.staticforge.api.dto.GenerationRequestDto;
import com.acme.staticforge.api.dto.GenerationRunView;
import com.acme.staticforge.common.ProblemFactory;
import com.acme.staticforge.common.SfException;
import com.acme.staticforge.generate.GenerationMode;
import com.acme.staticforge.generate.GenerationRequest;
import com.acme.staticforge.generate.GenerationRun;
import com.acme.staticforge.generate.GenerationService;
import com.acme.staticforge.security.SecuritySupport;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.net.URI;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.List;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
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
        SseEmitter emitter = new SseEmitter(SSE_TIMEOUT_MILLIS);
        generationService.registerEmitter(runId, emitter);
        GenerationRun run = generationService.status(projectKey, runId);
        emitCurrent(run, emitter);
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
                run.getDiagnostics());
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
