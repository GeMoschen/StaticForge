package com.acme.staticforge.scheduler;

/** Which versions a scheduled release makes live (epic decision 22). */
public enum PinPolicy {
    /** The versions current when the schedule was created or last re-pinned. */
    PINNED,
    /** Whatever is saved when the action executes. */
    LATEST
}
