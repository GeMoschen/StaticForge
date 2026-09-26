package com.acme.staticforge.scheduler.actions;

import com.acme.staticforge.generate.GenerationAuthorization;
import com.acme.staticforge.release.ReleaseItem;
import com.acme.staticforge.release.ReleaseOutcome;
import com.acme.staticforge.release.ReleasePlan;
import com.acme.staticforge.release.ReleaseProblems;
import com.acme.staticforge.release.ReleaseService;
import com.acme.staticforge.release.ReleaseStatus;
import com.acme.staticforge.release.ReleaseTarget;
import com.acme.staticforge.revision.RevisionContext;
import com.acme.staticforge.scheduler.ActionDescription;
import com.acme.staticforge.scheduler.ActionSpec;
import com.acme.staticforge.scheduler.ExecutionContext;
import com.acme.staticforge.scheduler.ExecutionResult;
import com.acme.staticforge.scheduler.PinPolicy;
import com.acme.staticforge.scheduler.ScheduledGenerationStarter;
import com.acme.staticforge.scheduler.SchedulerProblems;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.springframework.stereotype.Component;
import org.springframework.transaction.PlatformTransactionManager;

/**
 * Scheduled {@code RELEASE} (M27.4.2, epic decisions 21, 22): makes a set of (asset, locale) live at a time, in one
 * release revision per execution.
 *
 * <p>Params as requested: {@code {items:[{assetUuid, locale?}], includeDependencies:[…], comment?}}; stored:
 * {@code {resolved:true, items:[{assetUuid, locale, pinnedVersionId?, deletion?}], comment?}} — every locale key resolved and the
 * kept dependencies stored as items, so what executes is what the user saw. With {@link PinPolicy#PINNED} (default)
 * each item keeps the version that was the draft when it was scheduled (or last re-pinned), and a pinned version with
 * blocking completeness findings is refused up front ({@code 422 SF-DOM-0150}); with {@link PinPolicy#LATEST} the
 * draft at execution is released and an incomplete item is skipped then.
 *
 * <p>At execution an item that can't be released any more — its asset or locale is gone, a pinned item's draft was
 * deleted (or a scheduled deletion restored) since, a latest item is incomplete — is skipped with its reason and the
 * rest is released: outcome {@code PARTIAL} with {@code detail.items[]}.
 */
@Component
public class ReleaseActionHandler extends ReleaseStateActionHandler {

    public static final String TYPE = "RELEASE";

    /** Marks stored params: items resolved to locale keys (and pinned); request params don't carry it. */
    static final String RESOLVED = "resolved";

    private final ScheduleDrift drift;

    public ReleaseActionHandler(
            ReleaseService releases,
            ScheduledGenerationStarter generations,
            PlatformTransactionManager transactionManager,
            GenerationAuthorization generationAuthorization,
            ScheduleDrift drift) {
        super(releases, generations, transactionManager, generationAuthorization);
        this.drift = drift;
    }

    @Override
    public String type() {
        return TYPE;
    }

    @Override
    String verb() {
        return "release";
    }

    @Override
    String pastTense() {
        return "released";
    }

    /**
     * Resolves request params ({@code items} + {@code includeDependencies}), pinning the drafts when {@code PINNED}.
     * Params already {@code resolved} (an edit that keeps the stored items) keep their pins while the policy stays
     * {@code PINNED}; they are checked again (the assets still exist, the pinned versions are complete).
     */
    @Override
    public ActionSpec validate(ActionSpec draft, long actorUserId) {
        PinPolicy pinPolicy = draft.pinPolicy() == null ? PinPolicy.PINNED : draft.pinPolicy();
        ObjectNode params = JSON.objectNode();
        params.put(RESOLVED, true);
        if (draft.params() != null && draft.params().path(RESOLVED).asBoolean(false)) {
            params.set("items", revalidated(draft.projectId(), StoredItem.parse(draft.params()), pinPolicy));
        } else {
            List<ReleaseItem> items = new ArrayList<>(requestItems(draft.params(), "items"));
            items.addAll(requestItems(draft.params(), "includeDependencies"));
            params.set("items", pinned(draft.projectId(), items, pinPolicy));
        }
        String comment = comment(draft.params());
        if (comment != null) {
            params.put("comment", comment);
        }
        JsonNode thenGenerate = normalizeThenGenerate(draft.projectId(), draft.thenGenerate(), actorUserId);
        return new ActionSpec(draft.projectId(), draft.actionId(), TYPE, params, pinPolicy, thenGenerate, false);
    }

    @Override
    public JsonNode repin(ActionSpec spec, long actorUserId) {
        if (spec.pinPolicy() != PinPolicy.PINNED) {
            throw SchedulerProblems.repinNotApplicable();
        }
        List<ReleaseItem> items = StoredItem.parse(spec.params()).stream().map(i -> i.toReleaseItem(true)).toList();
        ObjectNode params = spec.params().deepCopy();
        params.set("items", pinned(spec.projectId(), items, PinPolicy.PINNED));
        return params;
    }

    @Override
    public Map<Long, ActionDescription> describe(List<ActionSpec> specs) {
        return drift.forActions(specs);
    }

    /**
     * The stored items of {@code items}: every locale key the plan resolves, with the draft version pinned when
     * {@code PINNED}. Items with nothing to release (a deletion released nowhere) are left out.
     */
    private ArrayNode pinned(long projectId, List<ReleaseItem> items, PinPolicy pinPolicy) {
        ReleasePlan plan = releases.plan(projectId, items);
        if (pinPolicy == PinPolicy.PINNED) {
            requireComplete(plan);
        }
        ArrayNode stored = JSON.arrayNode();
        Set<String> seen = new HashSet<>();
        for (ReleaseTarget target : plan.items()) {
            if (target.status() == null || !seen.add(key(target.assetUuid(), target.locale()))) {
                continue;
            }
            boolean deletion = target.status() == ReleaseStatus.DELETION_PENDING;
            Long pin = pinPolicy == PinPolicy.PINNED && !deletion ? target.versionId() : null;
            stored.add(new StoredItem(target.assetUuid(), target.locale(), pin, deletion).toJson());
        }
        if (stored.isEmpty()) {
            throw SchedulerProblems.invalidParams("Nothing to release: the selection is deleted and released nowhere.", "items");
        }
        return stored;
    }

    /** Stored items checked again: pins kept while {@code PINNED} and complete, re-resolved otherwise. */
    private ArrayNode revalidated(long projectId, List<StoredItem> stored, PinPolicy pinPolicy) {
        boolean allPinned = !stored.isEmpty() && stored.stream().allMatch(i -> i.pinnedVersionId() != null || i.deletion());
        if (pinPolicy != PinPolicy.PINNED || !allPinned) {
            return pinned(projectId, stored.stream().map(i -> i.toReleaseItem(true)).toList(), pinPolicy);
        }
        ReleasePlan plan = releases.plan(projectId, stored.stream().map(i -> i.toReleaseItem(false)).toList());
        requireComplete(plan);
        ArrayNode out = JSON.arrayNode();
        stored.forEach(i -> out.add(i.toJson()));
        return out;
    }

    private static void requireComplete(ReleasePlan plan) {
        if (plan.incomplete().isEmpty()) {
            return;
        }
        List<Map<String, Object>> incomplete = new ArrayList<>();
        plan.incomplete().forEach(i -> incomplete.add(Map.of(
                "uuid", i.assetUuid().toString(), "locale", i.locale(), "issues", i.issues())));
        throw ReleaseProblems.incomplete(incomplete);
    }

    @Override
    public ExecutionResult execute(ExecutionContext ctx) {
        ObjectNode progress = ctx.progress();
        if (!progress.has("items")) {
            progress = release(ctx);
        }
        return afterStateChange(ctx, progress);
    }

    /** Releases what can be released, in one revision, and records the per-item results with it. */
    private ObjectNode release(ExecutionContext ctx) {
        ActionSpec spec = ctx.spec();
        boolean pinned = spec.pinPolicy() != PinPolicy.LATEST;
        List<StoredItem> stored = StoredItem.parse(spec.params());
        List<ReleaseItem> requested = stored.stream().map(i -> i.toReleaseItem(!pinned)).toList();
        Probe probe = probe(spec.projectId(), requested);
        Map<String, ReleaseTarget> targets = targets(probe.plan());
        Map<String, Integer> incomplete = new HashMap<>();
        if (probe.plan() != null) {
            probe.plan().incomplete().forEach(i -> incomplete.put(key(i.assetUuid(), i.locale()), i.issues().size()));
        }

        Map<Integer, ObjectNode> results = new HashMap<>();
        List<Integer> releasable = new ArrayList<>();
        for (int i = 0; i < stored.size(); i++) {
            StoredItem item = stored.get(i);
            String key = key(item.assetUuid(), item.locale());
            ReleaseTarget target = targets.get(key);
            String reason = probe.failures().get(i);
            if (reason == null && target == null) {
                reason = "Not found.";
            } else if (reason == null && pinned && !item.deletion() && target.status() == ReleaseStatus.DELETION_PENDING) {
                reason = "Deleted since it was scheduled.";
            } else if (reason == null && pinned && item.deletion() && target.status() != ReleaseStatus.DELETION_PENDING) {
                reason = "Restored since its deletion was scheduled.";
            } else if (reason == null && incomplete.containsKey(key)) {
                reason = "Content incomplete: " + incomplete.get(key) + " blocking finding(s).";
            }
            if (reason != null) {
                results.put(i, itemResult(item, SKIPPED, reason));
            } else {
                releasable.add(i);
            }
        }

        String comment = revisionComment(ctx.actionId(), comment(spec.params()));
        return tx.execute(status -> {
            ObjectNode progress = JSON.objectNode();
            Long revision = null;
            if (!releasable.isEmpty()) {
                ReleaseOutcome outcome = releases.release(
                        releasable.stream().map(requested::get).toList(),
                        RevisionContext.of(spec.projectId(), ctx.ownerUserId(), comment));
                revision = outcome.revision();
                Set<String> applied = new HashSet<>();
                outcome.applied().forEach(t -> applied.add(key(t.assetUuid(), t.locale())));
                for (int i : releasable) {
                    StoredItem item = stored.get(i);
                    boolean changed = applied.contains(key(item.assetUuid(), item.locale()));
                    results.put(i, itemResult(item, changed ? APPLIED : UNCHANGED, changed ? null : "Already published."));
                }
            }
            ArrayNode items = progress.putArray("items");
            for (int i = 0; i < stored.size(); i++) {
                items.add(results.get(i));
            }
            if (revision != null) {
                progress.put("revision", revision);
            }
            ctx.checkpoint(progress, revision, null);
            return progress;
        });
    }
}
