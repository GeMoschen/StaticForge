package com.acme.staticforge.generate.target;

import com.acme.staticforge.generate.pipeline.OutputFile;
import java.util.List;
import java.util.Optional;
import java.util.Set;

/**
 * Writes a staged set of {@link OutputFile}s for a single generation run to an output backend and
 * manages atomic publication and rollback (spec §18.4).
 *
 * <p>Lifecycle per run: {@link #stage} writes/copies every file for the run (never publishing),
 * {@link #writeManifest} records what the build holds, {@link #publish} atomically flips the backend's "current"
 * reference to the staged run, and {@link #promote} re-points "current" at a previously published (successful) run.
 *
 * <p><b>Carrying a build forward (M22.4.1).</b> An incremental or scoped run renders only part of the site. It stages
 * with {@link #stage(long, long, List, Set)}: the base build's files, minus {@code removedPaths} and the paths it
 * overwrites, plus its own files, all into the run's own staging area. The base build is only read, so it stays
 * intact, and the new build is still published by one flip.
 */
public interface TargetWriter {

    /** Writes/copies all files for {@code runId} to the run's isolated staging area (no flip). */
    void stage(long runId, List<OutputFile> files);

    /**
     * Stages {@code runId} as build {@code baseRunId}'s files minus {@code removedPaths}, overlaid with {@code files}.
     *
     * @throws IllegalStateException when the base build no longer exists
     */
    void stage(long runId, long baseRunId, List<OutputFile> files, Set<String> removedPaths);

    /** Stores the manifest of the staged build {@code runId}; kept and pruned with the build. */
    void writeManifest(long runId, BuildManifest manifest);

    /** The manifest of build {@code runId}; empty when the build is gone or has none. */
    Optional<BuildManifest> readManifest(long runId);

    /** One file of build {@code runId}; empty when the build or the file doesn't exist. */
    Optional<byte[]> readFile(long runId, String path);

    /** Atomically publishes the staged run to the backend's {@code current} reference. */
    void publish(long runId);

    /** Re-points {@code current} at a prior successful build directory/artifact for {@code runId}. */
    void promote(long runId);

    /** The run {@code current} points at, or {@code -1} when nothing was published. */
    long currentRunId();

    /** A short human-readable description of this target (backend + destination). */
    String describe();
}
