package com.acme.staticforge.generate.pipeline;

/**
 * A point where a generation run may stop (M29.2.1): the pipeline calls {@link #check()} between units of work (each
 * page of the render loop) and lets the {@link RunAbortedException} it throws propagate, so a cancelled or recovered
 * run stops within one unit instead of rendering to the end.
 */
@FunctionalInterface
public interface RunCheckpoint {

    /** Never stops (previews, dry runs, tests of the pipeline alone). */
    RunCheckpoint NONE = () -> {};

    /** Returns when the run may go on; throws {@link RunAbortedException} when it must stop. */
    void check();
}
