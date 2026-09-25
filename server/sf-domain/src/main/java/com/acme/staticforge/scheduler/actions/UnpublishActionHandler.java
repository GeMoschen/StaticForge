package com.acme.staticforge.scheduler.actions;

import com.acme.staticforge.release.ReleaseItem;
import com.acme.staticforge.release.ReleaseOutcome;
import com.acme.staticforge.release.ReleasePlan;
import com.acme.staticforge.release.ReleaseService;
import com.acme.staticforge.release.ReleaseTarget;
import com.acme.staticforge.revision.RevisionContext;
import com.acme.staticforge.scheduler.ActionSpec;
import com.acme.staticforge.scheduler.ExecutionContext;
import com.acme.staticforge.scheduler.ExecutionResult;
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
 * Scheduled {@code UNPUBLISH} (M27.4.2, epic decision 21): takes a set of (asset, locale) offline at a time, in one
 * revision; the drafts stay. Params {@code {items:[{assetUuid, locale?}], comment?}}, stored with every locale key
 * resolved ({@code resolved: true}). Items already unreleased are no-ops; an item whose asset or locale is gone is
 * skipped with its reason.
 */
@Component
public class UnpublishActionHandler extends ReleaseStateActionHandler {

    public static final String TYPE = "UNPUBLISH";

    public UnpublishActionHandler(
            ReleaseService releases, ScheduledGenerationStarter generations, PlatformTransactionManager transactionManager) {
        super(releases, generations, transactionManager);
    }

    @Override
    public String type() {
        return TYPE;
    }

    @Override
    String verb() {
        return "unpublish";
    }

    @Override
    String pastTense() {
        return "unpublished";
    }

    @Override
    public ActionSpec validate(ActionSpec draft, long actorUserId) {
        List<ReleaseItem> items = draft.params() != null && draft.params().path(ReleaseActionHandler.RESOLVED).asBoolean(false)
                ? StoredItem.parse(draft.params()).stream().map(i -> i.toReleaseItem(true)).toList()
                : requestItems(draft.params(), "items");
        ReleasePlan plan = releases.plan(draft.projectId(), items);
        ArrayNode stored = JSON.arrayNode();
        Set<String> seen = new HashSet<>();
        for (ReleaseTarget target : plan.items()) {
            if (seen.add(key(target.assetUuid(), target.locale()))) {
                stored.add(new StoredItem(target.assetUuid(), target.locale(), null, false).toJson());
            }
        }
        if (stored.isEmpty()) {
            throw SchedulerProblems.invalidParams("Select at least one asset.", "items");
        }
        ObjectNode params = JSON.objectNode();
        params.put(ReleaseActionHandler.RESOLVED, true);
        params.set("items", stored);
        String comment = comment(draft.params());
        if (comment != null) {
            params.put("comment", comment);
        }
        JsonNode thenGenerate = normalizeThenGenerate(draft.projectId(), draft.thenGenerate(), actorUserId);
        return new ActionSpec(draft.projectId(), draft.actionId(), TYPE, params, null, thenGenerate, false);
    }

    @Override
    public ExecutionResult execute(ExecutionContext ctx) {
        ObjectNode progress = ctx.progress();
        if (!progress.has("items")) {
            progress = unpublish(ctx);
        }
        return afterStateChange(ctx, progress);
    }

    private ObjectNode unpublish(ExecutionContext ctx) {
        ActionSpec spec = ctx.spec();
        List<StoredItem> stored = StoredItem.parse(spec.params());
        List<ReleaseItem> requested = stored.stream().map(i -> i.toReleaseItem(true)).toList();
        Probe probe = probe(spec.projectId(), requested);
        Map<Integer, ObjectNode> results = new HashMap<>();
        List<Integer> resolvable = new ArrayList<>();
        for (int i = 0; i < stored.size(); i++) {
            String reason = probe.failures().get(i);
            if (reason != null) {
                results.put(i, itemResult(stored.get(i), SKIPPED, reason));
            } else {
                resolvable.add(i);
            }
        }
        String comment = revisionComment(ctx.actionId(), comment(spec.params()));
        return tx.execute(status -> {
            ObjectNode progress = JSON.objectNode();
            Long revision = null;
            if (!resolvable.isEmpty()) {
                ReleaseOutcome outcome = releases.unpublish(
                        resolvable.stream().map(requested::get).toList(),
                        RevisionContext.of(spec.projectId(), ctx.ownerUserId(), comment));
                revision = outcome.revision();
                Set<String> applied = new HashSet<>();
                outcome.applied().forEach(t -> applied.add(key(t.assetUuid(), t.locale())));
                for (int i : resolvable) {
                    StoredItem item = stored.get(i);
                    boolean changed = applied.contains(key(item.assetUuid(), item.locale()));
                    results.put(i, itemResult(item, changed ? APPLIED : UNCHANGED, changed ? null : "Not released."));
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
