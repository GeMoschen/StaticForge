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

    /**
     * Stores sidecar {@code name} of the staged build {@code runId} ({@code builds/{runId}.{name}.json} next to the
     * manifest, outside the served files; M30.1.3): data about the build that isn't part of the site, such as the
     * quality check facts. Kept and pruned with the build like the manifest.
     *
     * @param name a lower-case word ({@code quality})
     */
    void writeSidecar(long runId, String name, byte[] bytes);

    /** Sidecar {@code name} of build {@code runId}; empty when the build is gone or has none. */
    Optional<byte[]> readSidecar(long runId, String name);

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

    /**
     * The runs whose published build this target holds on disk, plus the run {@code current} points at while its build
     * exists (M29.2.2, M29.3.1): the rollback points {@code keep-builds} keeps, which run retention must never delete.
     * A published build is one with a manifest (filesystem, S3) or a finished archive (ZIP); a staged build of a run
     * that never published is not listed.
     */
    Set<Long> retainedRunIds();

    /**
     * Everything this target keeps per run, plus leftover temporary links (M29.2.2), for {@code build-output-cleanup}
     * to judge against the run rows. Empty for a backend whose cleanup is not supported (the S3 local mirror).
     */
    List<StoredItem> storedItems();

    /** The bytes {@code item} takes on disk: a directory walk that doesn't follow links. */
    long sizeOf(StoredItem item);

    /**
     * Deletes {@code item} (a directory recursively, a link as a link, never following it) after checking that it lies
     * under this target's root and is not the build {@code current} points at.
     *
     * @throws IllegalArgumentException for an item outside the target root or the current build
     */
    void delete(StoredItem item);
}
