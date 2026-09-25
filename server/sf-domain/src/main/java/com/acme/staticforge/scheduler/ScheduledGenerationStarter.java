package com.acme.staticforge.scheduler;

import com.acme.staticforge.generate.GenerationMode;
import java.util.List;
import java.util.UUID;

/**
 * Starts generation runs for scheduled actions (M27.4.2, M27.4.3). Declared here, implemented next to the generation
 * service in {@code sf-generate}, so a scheduled release can start its "then generate" run without {@code sf-domain}
 * depending on generation.
 */
public interface ScheduledGenerationStarter {

    /**
     * A run to start.
     *
     * @param revision {@code null} for the current revision
     * @param targetId {@code null} for the project's default target
     * @param channels empty for every channel
     * @param idempotencyKey a key unique to the action and slot, so a retry never starts a second run
     */
    record Order(
            long projectId,
            GenerationMode mode,
            Long revision,
            Long targetId,
            List<String> channels,
            String folderPath,
            List<UUID> assetUuids,
            String comment,
            long userId,
            String idempotencyKey) {

        public Order {
            channels = channels == null ? List.of() : List.copyOf(channels);
            assetUuids = assetUuids == null ? List.of() : List.copyOf(assetUuids);
        }
    }

    /** What {@link #start} did. */
    sealed interface Start permits Started, Busy, Refused {}

    /** The run was accepted. */
    record Started(long runId) implements Start {}

    /** Another run of the project is active; nothing was started (epic decision 27). */
    record Busy(Long activeRunId) implements Start {}

    /**
     * The run can't start.
     *
     * @param permanent {@code true} when every later attempt would fail the same way (the target is gone)
     */
    record Refused(String code, String message, boolean permanent) implements Start {}

    /**
     * Checks the target, channels and scope of {@code order} against the project as it is now: {@code 422 SF-DOM-0161}
     * naming the field.
     */
    void validate(Order order);

    /**
     * Starts {@code order} as its user. Joins the caller's transaction, so the caller can record the run in the same
     * commit; an unexpected failure is thrown (and rolls that transaction back).
     */
    Start start(Order order);
}
