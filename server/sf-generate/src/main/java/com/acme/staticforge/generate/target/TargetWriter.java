package com.acme.staticforge.generate.target;

import com.acme.staticforge.generate.pipeline.OutputFile;
import java.util.List;

/**
 * Writes a staged set of {@link OutputFile}s for a single generation run to an output backend and
 * manages atomic publication and rollback (spec §18.4).
 *
 * <p>Lifecycle per run: {@link #stage} writes/copies every file for the run (never publishing),
 * {@link #publish} atomically flips the backend's "current" reference to the staged run, and
 * {@link #promote} re-points "current" at a previously published (successful) run.
 */
public interface TargetWriter {

    /** Writes/copies all files for {@code runId} to the run's isolated staging area (no flip). */
    void stage(long runId, List<OutputFile> files);

    /** Atomically publishes the staged run to the backend's {@code current} reference. */
    void publish(long runId);

    /** Re-points {@code current} at a prior successful build directory/artifact for {@code runId}. */
    void promote(long runId);

    /** A short human-readable description of this target (backend + destination). */
    String describe();
}
