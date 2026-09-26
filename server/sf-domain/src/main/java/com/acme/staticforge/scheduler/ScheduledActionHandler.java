package com.acme.staticforge.scheduler;

import com.acme.staticforge.project.publish.PublishRequirements;
import com.fasterxml.jackson.databind.JsonNode;
import java.util.List;
import java.util.Map;

/**
 * One type of scheduled action (M27.4.1, epic decision 20). A new type is a new bean; the engine, the API and the
 * {@code scheduled_action} table know nothing type-specific. Handlers are called without a transaction.
 */
public interface ScheduledActionHandler {

    /** Whether the type runs once at a time or on a cron (epic decision 21). */
    enum Timing {
        ONE_OFF,
        RECURRING
    }

    /** The value stored in {@code scheduled_action.type}. */
    String type();

    Timing timing();

    /**
     * Checks a draft on create and edit and returns what is stored: normalized {@code params} (a release resolves its
     * items and pins their versions), and the pin policy and "then generate" options the type supports ({@code null}
     * for those it doesn't). Throws a {@code 422} problem ({@code SF-DOM-0161} unless a more specific code applies).
     *
     * @param actorUserId the user creating or editing the action
     */
    ActionSpec validate(ActionSpec draft, long actorUserId);

    /**
     * What the owner, and anyone changing the action, needs (epic decision 20; M28 decision 9: the publish permissions
     * of the action as saved, "then generate" included); evaluated by {@link ActionAuthority}.
     */
    PublishRequirements requirements(ActionSpec spec);

    /** Executes one slot as the owner; see {@link ExecutionContext} for re-runs. May throw — the execution then fails. */
    ExecutionResult execute(ExecutionContext ctx);

    /** The (asset, locale) pairs the action touches, for {@code scheduled} on asset views (M27.4.4). */
    default List<ActionAsset> assets(ActionSpec spec) {
        return List.of();
    }

    /** What each of {@code specs} works on, keyed by action id — one bulk lookup per call (M27.4.4). */
    default Map<Long, ActionDescription> describe(List<ActionSpec> specs) {
        return Map.of();
    }

    /**
     * The params of {@code spec} re-pinned to the current drafts (M27.4.2), validated like a new action. Types without
     * pinned versions refuse with {@code 422 SF-DOM-0168}.
     */
    default JsonNode repin(ActionSpec spec, long actorUserId) {
        throw SchedulerProblems.repinNotApplicable();
    }
}
