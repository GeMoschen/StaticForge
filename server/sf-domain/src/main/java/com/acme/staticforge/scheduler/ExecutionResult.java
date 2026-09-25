package com.acme.staticforge.scheduler;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;

/**
 * What {@link ScheduledActionHandler#execute} reports (M27.4.1). {@link State#WAITING} keeps the execution open and
 * the action due, so the engine calls the handler again on the next tick (epic decision 27); every other result
 * finishes the execution. {@code detail} is merged into the progress the handler checkpointed.
 *
 * @param outcome for {@link State#WAITING}: the outcome the execution ends with if it is abandoned (cancelled)
 * @param pause a failure that would repeat on every slot (the owner lost the permission, the target is gone): a
 *     recurring action is paused ({@code FAILED}, no next run) until someone takes it over
 */
public record ExecutionResult(State state, ExecutionOutcome outcome, String message, JsonNode detail, boolean pause) {

    public enum State {
        FINISHED,
        WAITING
    }

    public static ExecutionResult succeeded(String message, JsonNode detail) {
        return new ExecutionResult(State.FINISHED, ExecutionOutcome.SUCCEEDED, message, detail, false);
    }

    public static ExecutionResult partial(String message, JsonNode detail) {
        return new ExecutionResult(State.FINISHED, ExecutionOutcome.PARTIAL, message, detail, false);
    }

    public static ExecutionResult skipped(String message) {
        return new ExecutionResult(State.FINISHED, ExecutionOutcome.SKIPPED, message, null, false);
    }

    /** A failure of this slot; a recurring action runs again at its next slot. */
    public static ExecutionResult failed(String code, String message) {
        return new ExecutionResult(State.FINISHED, ExecutionOutcome.FAILED, message, code(code), false);
    }

    /** A failure every later slot would repeat: pauses a recurring action. */
    public static ExecutionResult failedAndPause(String code, String message) {
        return new ExecutionResult(State.FINISHED, ExecutionOutcome.FAILED, message, code(code), true);
    }

    /**
     * Not done yet: retry on the next tick.
     *
     * @param ifAbandoned the outcome if the execution ends while waiting ({@code SKIPPED} when nothing happened yet)
     */
    public static ExecutionResult waiting(String message, ExecutionOutcome ifAbandoned) {
        return new ExecutionResult(State.WAITING, ifAbandoned, message, null, false);
    }

    public boolean isWaiting() {
        return state == State.WAITING;
    }

    private static ObjectNode code(String code) {
        ObjectNode detail = JsonNodeFactory.instance.objectNode();
        if (code != null) {
            detail.put("code", code);
        }
        return detail;
    }
}
