package com.acme.staticforge.scheduler;

import com.fasterxml.jackson.databind.JsonNode;

/**
 * What a handler sees of an action (M27.4.1): the project, its type-specific {@code params}, and the release options
 * (pin policy, "then generate"). {@link ScheduledActionHandler#validate} receives the request's draft and returns the
 * normalized spec that is stored; the engine and the API pass the stored one.
 *
 * @param actionId {@code null} for an action being created
 * @param recurring whether the action runs on a cron
 */
public record ActionSpec(
        long projectId,
        Long actionId,
        String type,
        JsonNode params,
        PinPolicy pinPolicy,
        JsonNode thenGenerate,
        boolean recurring) {

    /** The stored spec of {@code action}. */
    public static ActionSpec of(ScheduledAction action) {
        return new ActionSpec(
                action.getProjectId(),
                action.getId(),
                action.getType(),
                action.getParams(),
                action.getPinPolicy(),
                action.getThenGenerate(),
                action.isRecurring());
    }

    public ActionSpec withParams(JsonNode params) {
        return new ActionSpec(projectId, actionId, type, params, pinPolicy, thenGenerate, recurring);
    }
}
