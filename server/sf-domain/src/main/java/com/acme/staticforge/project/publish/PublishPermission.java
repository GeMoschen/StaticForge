package com.acme.staticforge.project.publish;

import java.util.Arrays;
import java.util.Optional;

/**
 * What a project's publish policy can open to editors (M28, epic decision 1). {@code DEVELOPER}, {@code PROJECT_ADMIN}
 * and instance admins always hold all four; {@code VIEWER} never holds any ({@link PublishPolicy#grants}).
 */
public enum PublishPermission {
    /** Release, discard and unpublish content. */
    RELEASE,
    /** One-off scheduled release and unpublish actions, including their "then generate" step (needs {@link #RELEASE}). */
    SCHEDULE_RELEASE,
    /** Incremental, optionally scoped runs to the project's default target. */
    INCREMENTAL_BUILD,
    /** Full runs and runs to any target (needs {@link #INCREMENTAL_BUILD}). */
    FULL_BUILD;

    /** The permission named {@code name} (exact, upper case), empty for anything else. */
    public static Optional<PublishPermission> byName(String name) {
        return Arrays.stream(values()).filter(p -> p.name().equals(name)).findFirst();
    }
}
