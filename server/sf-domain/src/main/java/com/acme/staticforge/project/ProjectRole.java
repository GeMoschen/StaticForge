package com.acme.staticforge.project;

import java.util.Arrays;

/**
 * Per-project membership roles (spec §8.3). Ordering encodes increasing privilege so a
 * "minimum role" check is an ordinal comparison.
 */
public enum ProjectRole {
    VIEWER,
    EDITOR,
    DEVELOPER,
    PROJECT_ADMIN;

    public boolean atLeast(ProjectRole minimum) {
        return ordinal() >= minimum.ordinal();
    }

    public static ProjectRole fromName(String name) {
        return Arrays.stream(values())
                .filter(r -> r.name().equalsIgnoreCase(name))
                .findFirst()
                .orElseThrow(() -> new IllegalArgumentException("Unknown project role: " + name));
    }
}
