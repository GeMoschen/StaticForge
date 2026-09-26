package com.acme.staticforge.scheduler.actions;

import com.acme.staticforge.common.SfException;
import com.acme.staticforge.generate.GenerationAuthorization;
import com.acme.staticforge.generate.GenerationMode;
import com.acme.staticforge.project.publish.PublishPermission;
import com.acme.staticforge.project.publish.PublishRequirements;
import com.acme.staticforge.release.ReleaseItem;
import com.acme.staticforge.release.ReleasePlan;
import com.acme.staticforge.release.ReleaseService;
import com.acme.staticforge.release.ReleaseTarget;
import com.acme.staticforge.scheduler.ActionAsset;
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
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * What scheduled {@code RELEASE} and {@code UNPUBLISH} share (M27.4.2): the stored item list, the per-item probe that
 * lets one unreleasable item be skipped instead of failing the whole execution, and the optional "then generate" step
 * (epic decisions 21, 27).
 *
 * <p>Progress of an execution, in its {@code detail}: {@code items} (one result per item) and {@code revision} once
 * the state change committed — written in the same transaction as the revision, so a retry never repeats it — then
 * {@code generationRunId} once the follow-up run was started (same rule), or {@code waitingForRun} while a run of the
 * project blocks it.
 */
abstract class ReleaseStateActionHandler implements ScheduledActionHandler {

    static final JsonNodeFactory JSON = JsonNodeFactory.instance;

    /** Results of one item in {@code detail.items[].result}. */
    static final String APPLIED = "APPLIED";
    static final String UNCHANGED = "UNCHANGED";
    static final String SKIPPED = "SKIPPED";

    /** The length of {@code revision.comment}. */
    static final int MAX_COMMENT = 500;

    protected final ReleaseService releases;
    protected final ScheduledGenerationStarter generations;
    protected final TransactionTemplate tx;
    private final GenerationAuthorization generationAuthorization;

    ReleaseStateActionHandler(
            ReleaseService releases,
            ScheduledGenerationStarter generations,
            PlatformTransactionManager transactionManager,
            GenerationAuthorization generationAuthorization) {
        this.releases = releases;
        this.generations = generations;
        this.tx = new TransactionTemplate(transactionManager);
        this.generationAuthorization = generationAuthorization;
    }

    /** The verb in comments and messages ("release", "unpublish"). */
    abstract String verb();

    @Override
    public Timing timing() {
        return Timing.ONE_OFF;
    }

    /**
     * {@link PublishPermission#SCHEDULE_RELEASE} (M28 decision 9), plus, with "then generate", what that incremental
     * run to its target needs ({@link GenerationAuthorization}: {@code INCREMENTAL_BUILD} for the default target,
     * {@code FULL_BUILD} for another). Evaluated against the target as stored: a target that stops being the default
     * later raises the requirement, and the execution re-check catches it. The release service checks the owner's
     * {@code RELEASE} again, which {@code SCHEDULE_RELEASE} implies.
     */
    @Override
    public PublishRequirements requirements(ActionSpec spec) {
        PublishRequirements schedule = PublishRequirements.permission(PublishPermission.SCHEDULE_RELEASE);
        JsonNode then = spec.thenGenerate();
        if (then == null || then.isNull() || then.isMissingNode()) {
            return schedule;
        }
        Long targetId = then.path("targetId").isIntegralNumber() ? then.path("targetId").asLong() : null;
        return schedule.and(
                generationAuthorization.requiredFor(spec.projectId(), GenerationMode.INCREMENTAL, targetId, null));
    }

    @Override
    public List<ActionAsset> assets(ActionSpec spec) {
        return StoredItem.parse(spec.params()).stream().map(i -> new ActionAsset(i.assetUuid(), i.locale())).distinct().toList();
    }

    // ------------------------------------------------------------------
    // Validation helpers
    // ------------------------------------------------------------------

    /** The {@code {assetUuid, locale?}} entries of {@code params.field}; a blank locale means every locale. */
    static List<ReleaseItem> requestItems(JsonNode params, String field) {
        JsonNode array = params == null ? null : params.get(field);
        if (array == null || array.isNull()) {
            return List.of();
        }
        if (!array.isArray()) {
            throw SchedulerProblems.invalidParams("'" + field + "' must be a list of {assetUuid, locale}.", field);
        }
        List<ReleaseItem> items = new ArrayList<>();
        for (JsonNode entry : array) {
            UUID uuid;
            try {
                uuid = UUID.fromString(entry.path("assetUuid").asText());
            } catch (IllegalArgumentException e) {
                throw SchedulerProblems.invalidParams("Every entry of '" + field + "' needs an assetUuid.", field);
            }
            String locale = entry.path("locale").isTextual() && !entry.path("locale").asText().isBlank()
                    ? entry.path("locale").asText()
                    : null;
            items.add(new ReleaseItem(uuid, locale, null));
        }
        return items;
    }

    /** "Scheduled release #12: {comment}", within the 500 characters a revision comment holds. */
    String revisionComment(long actionId, String userComment) {
        String text = "Scheduled " + verb() + " #" + actionId + (userComment == null ? "" : ": " + userComment);
        return text.length() <= MAX_COMMENT ? text : text.substring(0, MAX_COMMENT - 1) + "…";
    }

    static String comment(JsonNode params) {
        JsonNode comment = params == null ? null : params.get("comment");
        return comment != null && comment.isTextual() && !comment.asText().isBlank() ? comment.asText().trim() : null;
    }

    /** {@code {targetId, channels}} checked against the project, or {@code null} when there is no follow-up build. */
    JsonNode normalizeThenGenerate(long projectId, JsonNode thenGenerate, long actorUserId) {
        if (thenGenerate == null || thenGenerate.isNull() || thenGenerate.isMissingNode()) {
            return null;
        }
        if (!thenGenerate.isObject()) {
            throw SchedulerProblems.invalidParams("'thenGenerate' must be an object {targetId?, channels?}.", "thenGenerate");
        }
        Long targetId = thenGenerate.path("targetId").isIntegralNumber() ? thenGenerate.path("targetId").asLong() : null;
        List<String> channels = new ArrayList<>();
        JsonNode list = thenGenerate.path("channels");
        if (!list.isMissingNode() && !list.isNull()) {
            if (!list.isArray()) {
                throw SchedulerProblems.invalidParams("'thenGenerate.channels' must be a list.", "thenGenerate.channels");
            }
            list.forEach(c -> channels.add(c.asText()));
        }
        generations.validate(new ScheduledGenerationStarter.Order(
                projectId, GenerationMode.INCREMENTAL, null, targetId, channels, null, null, null, actorUserId, null, null));
        ObjectNode normalized = JSON.objectNode();
        if (targetId == null) {
            normalized.putNull("targetId");
        } else {
            normalized.put("targetId", targetId);
        }
        ArrayNode stored = normalized.putArray("channels");
        channels.forEach(stored::add);
        return normalized;
    }

    // ------------------------------------------------------------------
    // Execution helpers
    // ------------------------------------------------------------------

    /**
     * The release plan of {@code items}, with the items that can't be resolved any more (asset gone, locale removed,
     * a pinned version that isn't the asset's) set apart by index with the reason. Planning is read-only and runs
     * outside the transaction of the state change, so an item's refusal can't mark that transaction rollback-only.
     */
    record Probe(ReleasePlan plan, Map<Integer, String> failures) {}

    Probe probe(long projectId, List<ReleaseItem> items) {
        try {
            return new Probe(releases.plan(projectId, items), Map.of());
        } catch (SfException e) {
            if (!isItemProblem(e)) {
                throw e;
            }
        }
        Map<Integer, String> failures = new LinkedHashMap<>();
        List<ReleaseItem> resolvable = new ArrayList<>();
        for (int i = 0; i < items.size(); i++) {
            try {
                releases.plan(projectId, List.of(items.get(i)));
                resolvable.add(items.get(i));
            } catch (SfException e) {
                if (!isItemProblem(e)) {
                    throw e;
                }
                failures.put(i, e.getProblem().getDetail());
            }
        }
        return new Probe(resolvable.isEmpty() ? null : releases.plan(projectId, resolvable), failures);
    }

    private static boolean isItemProblem(SfException e) {
        Object code = e.getProblem() == null ? null : e.getProblem().getExtensions().get("code");
        return "SF-DOM-0151".equals(code) || "SF-DOM-0154".equals(code);
    }

    /** The plan's targets by {@code uuid|locale}. */
    static Map<String, ReleaseTarget> targets(ReleasePlan plan) {
        Map<String, ReleaseTarget> byKey = new LinkedHashMap<>();
        if (plan != null) {
            plan.items().forEach(t -> byKey.put(key(t.assetUuid(), t.locale()), t));
        }
        return byKey;
    }

    static String key(UUID uuid, String locale) {
        return uuid + "|" + (locale == null ? "" : locale);
    }

    static ObjectNode itemResult(StoredItem item, String result, String reason) {
        ObjectNode node = JSON.objectNode();
        node.put("assetUuid", item.assetUuid().toString());
        node.put("locale", item.locale());
        node.put("result", result);
        if (reason != null) {
            node.put("reason", reason);
        }
        return node;
    }

    /** {@code SUCCEEDED} when every item was applied or needed nothing, {@code FAILED} when none was, else {@code PARTIAL}. */
    static ExecutionOutcome outcome(JsonNode items) {
        int skipped = 0;
        for (JsonNode item : items) {
            if (SKIPPED.equals(item.path("result").asText())) {
                skipped++;
            }
        }
        if (skipped == 0) {
            return ExecutionOutcome.SUCCEEDED;
        }
        return skipped == items.size() ? ExecutionOutcome.FAILED : ExecutionOutcome.PARTIAL;
    }

    /** "2 released, 1 unchanged, 1 skipped". */
    String summary(JsonNode items) {
        int applied = 0;
        int unchanged = 0;
        int skipped = 0;
        for (JsonNode item : items) {
            switch (item.path("result").asText()) {
                case APPLIED -> applied++;
                case UNCHANGED -> unchanged++;
                default -> skipped++;
            }
        }
        StringBuilder out = new StringBuilder(applied + " " + pastTense());
        if (unchanged > 0) {
            out.append(", ").append(unchanged).append(" unchanged");
        }
        if (skipped > 0) {
            out.append(", ").append(skipped).append(" skipped");
        }
        return out.toString();
    }

    abstract String pastTense();

    /**
     * Finishes an execution whose state change is recorded in {@code progress}: starts the "then generate" run when
     * the action has one and a revision was written, waits while another run is active, and reports.
     */
    ExecutionResult afterStateChange(ExecutionContext ctx, ObjectNode progress) {
        ExecutionOutcome outcome = outcome(progress.path("items"));
        String summary = capitalize(summary(progress.path("items"))) + ".";
        JsonNode then = ctx.spec().thenGenerate();
        boolean revisionWritten = progress.path("revision").isIntegralNumber();
        if (outcome == ExecutionOutcome.FAILED || then == null || then.isNull() || !revisionWritten) {
            return new ExecutionResult(ExecutionResult.State.FINISHED, outcome, summary, progress, false);
        }
        if (progress.path("generationRunId").isIntegralNumber()) {
            return finished(outcome, summary + " Generation run #" + progress.path("generationRunId").asLong() + " started.", progress);
        }
        long revision = progress.path("revision").asLong();
        List<String> channels = new ArrayList<>();
        then.path("channels").forEach(c -> channels.add(c.asText()));
        ScheduledGenerationStarter.Order order = new ScheduledGenerationStarter.Order(
                ctx.spec().projectId(),
                GenerationMode.INCREMENTAL,
                revision,
                then.path("targetId").isIntegralNumber() ? then.path("targetId").asLong() : null,
                channels,
                null,
                null,
                "After scheduled " + verb() + " #" + ctx.actionId(),
                ctx.ownerUserId(),
                "schedule-" + ctx.actionId() + "-" + ctx.scheduledFor().toEpochMilli() + "-then",
                ctx.actionId());
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
            start = "SF-GEN-0500".equals(code)
                    // Lost a race with a manual start between the active-run check and the start.
                    ? new ScheduledGenerationStarter.Busy(null)
                    : new ScheduledGenerationStarter.Refused(
                            code == null ? null : code.toString(), e.getProblem().getDetail(), false);
        }
        ExecutionOutcome partial = ExecutionOutcome.PARTIAL;
        return switch (start) {
            case ScheduledGenerationStarter.Started started ->
                    finished(outcome, summary + " Generation run #" + started.runId() + " started.", progress);
            case ScheduledGenerationStarter.Busy busy -> {
                String run = busy.activeRunId() == null ? "another run" : "run #" + busy.activeRunId();
                if (ctx.latenessBoundPassed()) {
                    progress.remove("waitingForRun");
                    progress.set("generation", generationNote("SKIPPED", null, run + " was still active past the limit"));
                    yield finished(partial, summary + " Generation skipped: " + run + " was still active past the limit.", progress);
                }
                if (busy.activeRunId() != null) {
                    progress.put("waitingForRun", busy.activeRunId());
                }
                ctx.checkpoint(progress, null, null);
                yield ExecutionResult.waiting(summary + " Waiting for " + run + ".", partial);
            }
            case ScheduledGenerationStarter.Refused refused -> {
                progress.remove("waitingForRun");
                progress.set("generation", generationNote("FAILED", refused.code(), refused.message()));
                yield finished(partial, summary + " Generation not started: " + refused.message(), progress);
            }
        };
    }

    private static ExecutionResult finished(ExecutionOutcome outcome, String message, ObjectNode detail) {
        return new ExecutionResult(ExecutionResult.State.FINISHED, outcome, message, detail, false);
    }

    private static ObjectNode generationNote(String result, String code, String message) {
        ObjectNode note = JSON.objectNode();
        note.put("result", result);
        if (code != null) {
            note.put("code", code);
        }
        note.put("message", message);
        return note;
    }

    private static String capitalize(String text) {
        return text.isEmpty() ? text : Character.toUpperCase(text.charAt(0)) + text.substring(1);
    }

    /**
     * One stored item: {@code locale} is a locale key ({@code ""} for the shared key); {@code pinnedVersionId} the
     * version a pinned release makes live; {@code deletion} marks an item scheduled while its draft was deleted
     * (releasing it takes the asset offline).
     */
    record StoredItem(UUID assetUuid, String locale, Long pinnedVersionId, boolean deletion) {

        static List<StoredItem> parse(JsonNode params) {
            List<StoredItem> items = new ArrayList<>();
            JsonNode array = params == null ? null : params.get("items");
            if (array == null || !array.isArray()) {
                return items;
            }
            for (JsonNode entry : array) {
                items.add(new StoredItem(
                        UUID.fromString(entry.path("assetUuid").asText()),
                        entry.path("locale").asText(""),
                        entry.path("pinnedVersionId").isIntegralNumber() ? entry.path("pinnedVersionId").asLong() : null,
                        entry.path("deletion").asBoolean(false)));
            }
            return items;
        }

        ObjectNode toJson() {
            ObjectNode node = JSON.objectNode();
            node.put("assetUuid", assetUuid.toString());
            node.put("locale", locale);
            if (pinnedVersionId != null) {
                node.put("pinnedVersionId", pinnedVersionId);
            }
            if (deletion) {
                node.put("deletion", true);
            }
            return node;
        }

        /** A release item: the locale key, the pinned version unless {@code draft}. */
        ReleaseItem toReleaseItem(boolean draft) {
            return new ReleaseItem(assetUuid, locale, draft ? null : pinnedVersionId);
        }
    }
}
