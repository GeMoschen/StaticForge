package com.acme.staticforge.generate;

/**
 * What started a {@link GenerationRun} (M35.24): a person's own start ({@link #MANUAL}), a schedule — a generation
 * action, a recurring one or a release's "then generate" — ({@link #SCHEDULE}), or the build offered right after a
 * release ({@link #RELEASE}). A client may send {@code MANUAL} or {@code RELEASE}; only the scheduler starts {@code SCHEDULE}.
 */
public enum GenerationTrigger {
    MANUAL,
    SCHEDULE,
    RELEASE
}
