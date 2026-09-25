package com.acme.staticforge.generate.schedule;

import com.acme.staticforge.common.SfException;
import com.acme.staticforge.generate.GenerationMode;
import com.acme.staticforge.project.ProjectRole;
import com.acme.staticforge.scheduler.ActionRequirements;
import com.acme.staticforge.scheduler.ActionSpec;
import com.acme.staticforge.scheduler.ExecutionContext;
import com.acme.staticforge.scheduler.ExecutionOutcome;
import com.acme.staticforge.scheduler.ExecutionResult;
import com.acme.staticforge.scheduler.ScheduledActionHandler;
import com.acme.staticforge.scheduler.ScheduledGenerationStarter;
import com.acme.staticforge.scheduler.SchedulerProblems;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.UUID;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * Scheduled generation, one-off and recurring (M27.4.3, epic decisions 21, 23, 25, 27). Params
 * {@code {mode: FULL|INCREMENTAL, channels?, targetId?, scope?: {folderPath?, assetUuids?}, comment?}}; a scheduled
 * build always renders the revision current at execution, so {@code revision} is refused ({@code SF-DOM-0161}).
 *
 * <p>An execution finishes as soon as its run is <em>started</em> ({@code SUCCEEDED} = the run was accepted) and links
 * it ({@code generation_run_id}); how the run ends is in the run history. While another run of the project is active
 * the execution waits and is retried every tick; with {@code SKIP_IF_LATER_THAN} it ends {@code SKIPPED} once the
 * bound has passed. A recurring slot still waiting when the next one is due is coalesced with it (one run). A target
 * deleted since scheduling fails the execution with {@code SF-DOM-0162} and pauses a recurring action.
 *
 * <p>Re-running a slot (after a lease expiry) never starts a second run: the run id is recorded in the same
 * transaction that starts it, and the start carries the idempotency key {@code schedule-{id}-{scheduledFor}}.
 */
abstract class AbstractGenerationActionHandler implements ScheduledActionHandler {

    private static final JsonNodeFactory JSON = JsonNodeFactory.instance;
    private static final String BUSY_CODE = "SF-GEN-0500";

    private final ScheduledGenerationStarter generations;
    private final TransactionTemplate tx;

    AbstractGenerationActionHandler(ScheduledGenerationStarter generations, PlatformTransactionManager transactionManager) {
        this.generations = generations;
        this.tx = new TransactionTemplate(transactionManager);
    }

    /** {@code DEVELOPER}: building stays a developer operation in M27 and M28. */
    @Override
    public ActionRequirements requirements(ActionSpec spec) {
        return ActionRequirements.role(ProjectRole.DEVELOPER);
    }

    @Override
    public ActionSpec validate(ActionSpec draft, long actorUserId) {
        JsonNode params = draft.params();
        if (params == null || !params.isObject()) {
            throw SchedulerProblems.invalidParams("params must be an object {mode, channels?, targetId?, scope?}.", "params");
        }
        if (params.hasNonNull("revision")) {
            throw SchedulerProblems.invalidParams(
                    "A scheduled build always renders the revision current at execution; remove 'revision'.", "revision");
        }
        if (draft.pinPolicy() != null) {
            throw SchedulerProblems.invalidParams("A generation has no pin policy.", "pinPolicy");
        }
        if (draft.thenGenerate() != null && !draft.thenGenerate().isNull()) {
            throw SchedulerProblems.invalidParams("A generation has no 'then generate' step.", "thenGenerate");
        }
        GenerationMode mode = mode(params);
        List<String> channels = strings(params.path("channels"), "channels");
        Long targetId = params.path("targetId").isIntegralNumber() ? params.path("targetId").asLong() : null;
        if (params.hasNonNull("targetId") && targetId == null) {
            throw SchedulerProblems.invalidParams("targetId must be a number.", "targetId");
        }
        JsonNode scope = params.path("scope");
        String folderPath = scope.path("folderPath").isTextual() && !scope.path("folderPath").asText().isBlank()
                ? scope.path("folderPath").asText().trim()
                : null;
        List<UUID> assetUuids = new ArrayList<>();
        for (String value : strings(scope.path("assetUuids"), "scope.assetUuids")) {
            try {
                assetUuids.add(UUID.fromString(value));
            } catch (IllegalArgumentException e) {
                throw SchedulerProblems.invalidParams("Invalid asset uuid '" + value + "'.", "scope.assetUuids");
            }
        }
        generations.validate(new ScheduledGenerationStarter.Order(
                draft.projectId(), mode, null, targetId, channels, folderPath, assetUuids, null, actorUserId, null));

        ObjectNode stored = JSON.objectNode();
        stored.put("mode", mode.name());
        ArrayNode channelList = stored.putArray("channels");
        channels.forEach(channelList::add);
        if (targetId == null) {
            stored.putNull("targetId");
        } else {
            stored.put("targetId", targetId);
        }
        ObjectNode storedScope = stored.putObject("scope");
        if (folderPath == null) {
            storedScope.putNull("folderPath");
        } else {
            storedScope.put("folderPath", folderPath);
        }
        ArrayNode uuids = storedScope.putArray("assetUuids");
        assetUuids.forEach(u -> uuids.add(u.toString()));
        if (params.path("comment").isTextual() && !params.path("comment").asText().isBlank()) {
            stored.put("comment", params.path("comment").asText().trim());
        }
        return new ActionSpec(draft.projectId(), draft.actionId(), type(), stored, null, null, timing() == Timing.RECURRING);
    }

    @Override
    public ExecutionResult execute(ExecutionContext ctx) {
        ObjectNode progress = ctx.progress();
        if (progress.path("generationRunId").isIntegralNumber()) {
            return ExecutionResult.succeeded(
                    "Generation run #" + progress.path("generationRunId").asLong() + " started.", progress);
        }
        JsonNode params = ctx.spec().params();
        List<UUID> assetUuids = new ArrayList<>();
        params.path("scope").path("assetUuids").forEach(u -> assetUuids.add(UUID.fromString(u.asText())));
        String userComment = params.path("comment").isTextual() ? params.path("comment").asText() : null;
        ScheduledGenerationStarter.Order order = new ScheduledGenerationStarter.Order(
                ctx.spec().projectId(),
                GenerationMode.valueOf(params.path("mode").asText(GenerationMode.FULL.name())),
                null,
                params.path("targetId").isIntegralNumber() ? params.path("targetId").asLong() : null,
                strings(params.path("channels"), "channels"),
                params.path("scope").path("folderPath").isTextual() ? params.path("scope").path("folderPath").asText() : null,
                assetUuids,
                "Scheduled generation #" + ctx.actionId() + (userComment == null ? "" : ": " + userComment),
                ctx.ownerUserId(),
                "schedule-" + ctx.actionId() + "-" + ctx.scheduledFor().toEpochMilli());

        ScheduledGenerationStarter.Start start;
        try {
            start = tx.execute(status -> {
                ScheduledGenerationStarter.Start result = generations.start(order);
                if (result instanceof ScheduledGenerationStarter.Started started) {
                    progress.remove("waitingForRun");
                    progress.put("generationRunId", started.runId());
                    ctx.checkpoint(progress, null, started.runId());
                }
                return result;
            });
        } catch (SfException e) {
            Object code = e.getProblem() == null ? null : e.getProblem().getExtensions().get("code");
            if (!BUSY_CODE.equals(code)) {
                throw e;
            }
            // Lost a race with a manual start between the active-run check and the start.
            start = new ScheduledGenerationStarter.Busy(null);
        }
        return switch (start) {
            case ScheduledGenerationStarter.Started started ->
                    ExecutionResult.succeeded("Generation run #" + started.runId() + " started.", progress);
            case ScheduledGenerationStarter.Busy busy -> {
                String run = busy.activeRunId() == null ? "another run" : "run #" + busy.activeRunId();
                if (ctx.latenessBoundPassed()) {
                    yield ExecutionResult.skipped("Skipped: " + run + " was still active past the limit.");
                }
                if (busy.activeRunId() != null) {
                    progress.put("waitingForRun", busy.activeRunId());
                    ctx.checkpoint(progress, null, null);
                }
                yield ExecutionResult.waiting("Waiting for " + run + ".", ExecutionOutcome.SKIPPED);
            }
            case ScheduledGenerationStarter.Refused refused -> refused.permanent()
                    ? ExecutionResult.failedAndPause(refused.code(), refused.message())
                    : ExecutionResult.failed(refused.code(), refused.message());
        };
    }

    private static GenerationMode mode(JsonNode params) {
        JsonNode mode = params.path("mode");
        if (mode.isMissingNode() || mode.isNull()) {
            return GenerationMode.FULL;
        }
        try {
            return GenerationMode.valueOf(mode.asText().trim().toUpperCase(Locale.ROOT));
        } catch (IllegalArgumentException e) {
            throw SchedulerProblems.invalidParams("mode must be FULL or INCREMENTAL.", "mode");
        }
    }

    private static List<String> strings(JsonNode node, String field) {
        List<String> out = new ArrayList<>();
        if (node == null || node.isMissingNode() || node.isNull()) {
            return out;
        }
        if (!node.isArray()) {
            throw SchedulerProblems.invalidParams("'" + field + "' must be a list.", field);
        }
        node.forEach(value -> out.add(value.asText()));
        return out;
    }
}
