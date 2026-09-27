package com.acme.staticforge.scheduler;

/**
 * Background work that runs on the {@link SchedulerEngine}'s poll (M29.1.1, epic decision 1): the engine is the
 * application's single scheduler, so other periodic work (the system jobs of M29) joins its tick instead of adding a
 * second polling mechanism. Beans of this type are registered with the application's engine when it starts.
 *
 * <p>{@link #onTick()} runs on the engine's poll thread right after the scheduled actions were claimed; it must not
 * block — claim what is due and hand the work to an executor. An exception is logged and never stops the poll.
 */
@FunctionalInterface
public interface SchedulerTickParticipant {

    /** One poll of the engine. */
    void onTick();
}
