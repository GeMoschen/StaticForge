package com.acme.staticforge.generate;

/**
 * Observes the points a generation run passes on its executing thread (M29.2.1): each stage, each page of the render
 * loop and the moment before the final status write with its publish. Every bean of this type is called
 * synchronously, before the run checks whether it must stop, so a probe that blocks holds the run exactly there — the
 * seam the cancel and race tests use. Production registers none. A probe must not throw.
 */
public interface GenerationRunProbe {

    /** Reached once per page, inside the render loop, before the page renders. */
    String RENDER_PAGE = "RENDER_PAGE";

    /** Reached once per output in the quality check stage (M30.1.3), before the output is checked. */
    String CHECK_OUTPUT = "CHECK_OUTPUT";

    /** Reached after the build is staged, right before the final status write and the publish. */
    String PUBLISH = "PUBLISH";

    /**
     * Run {@code runId} of project {@code projectId} reached {@code point}: a stage name ({@code SNAPSHOT},
     * {@code PLAN}, {@code VALIDATE}, {@code RENDER}, {@code ASSETS}, {@code CHECK}, {@code POST},
     * {@code WRITE}), {@link #RENDER_PAGE}, {@link #CHECK_OUTPUT} or {@link #PUBLISH}.
     */
    void reached(long projectId, long runId, String point);
}
