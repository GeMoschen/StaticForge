package com.acme.staticforge.generate.target;

import com.acme.staticforge.generate.pipeline.OutputFile;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.util.Comparator;
import java.util.List;

/**
 * Filesystem target writer (spec §18.4). Stages a run into {@code {outputRoot}/builds/{runId}} and
 * atomically flips {@code {outputRoot}/current} at publish.
 *
 * <p><b>Atomic flip and platform note:</b> on platforms that support symlinks (not Windows) the
 * flip is a symlink swap: a temporary symlink {@code current -> builds/{runId}} is created and then
 * {@link Files#move(Files.move)}d over {@code current} with {@code ATOMIC_MOVE} (falling back to a
 * plain replace move). On Windows — where symlink creation is generally unavailable without
 * elevated privileges — the writer falls back to writing the {@code runId} into a tiny {@code
 * current} marker file. Both variants are readable by {@link #currentRunId()}. A failed or
 * incomplete {@code stage} never touches {@code current}.
 */
public final class FilesystemTargetWriter implements TargetWriter {

    private final Path outputRoot;
    private final int keepBuilds;

    public FilesystemTargetWriter(Path outputRoot, int keepBuilds) {
        this.outputRoot = outputRoot.toAbsolutePath().normalize();
        this.keepBuilds = Math.max(keepBuilds, 1);
    }

    private Path buildsDir() {
        return outputRoot.resolve("builds");
    }

    private Path buildDir(long runId) {
        return buildsDir().resolve(String.valueOf(runId));
    }

    private Path current() {
        return outputRoot.resolve("current");
    }

    @Override
    public void stage(long runId, List<OutputFile> files) {
        Path build = buildDir(runId);
        try {
            Files.createDirectories(build);
        } catch (IOException e) {
            throw new java.io.UncheckedIOException("Failed to create build directory " + build, e);
        }
        for (OutputFile file : files) {
            Path target = TargetIo.resolve(build, file.path());
            TargetIo.write(target, file.bytes());
        }
    }

    @Override
    public void publish(long runId) {
        Path build = buildDir(runId);
        if (!Files.isDirectory(build)) {
            throw new IllegalStateException("Staged build directory does not exist: " + build);
        }
        flipCurrent(runId, build);
        prune();
    }

    @Override
    public void promote(long runId) {
        Path build = buildDir(runId);
        if (!Files.isDirectory(build)) {
            throw new IllegalStateException("No prior build exists for run " + runId + ": " + build);
        }
        flipCurrent(runId, build);
    }

    @Override
    public String describe() {
        return "filesystem target at " + outputRoot;
    }

    /** Returns the runId {@code current} points at, or {@code -1} when unpublishes. */
    public long currentRunId() {
        return TargetIo.readRunId(current());
    }

    private void flipCurrent(long runId, Path build) {
        Path current = current();
        try {
            Files.createDirectories(outputRoot);
        } catch (IOException e) {
            throw new java.io.UncheckedIOException("Failed to create output root " + outputRoot, e);
        }
        if (!trySymlink(build, current)) {
            TargetIo.writeMarker(current, runId);
        }
    }

    /** Attempts an atomic symlink flip; returns {@code false} when symlinks are unsupported. */
    private boolean trySymlink(Path build, Path current) {
        if (TargetIo.isWindows()) {
            return false;
        }
        Path tmp = outputRoot.resolve(".current-" + System.nanoTime() + ".link");
        try {
            Files.deleteIfExists(tmp);
            Files.createSymbolicLink(tmp, build.toAbsolutePath().normalize());
            try {
                Files.move(tmp, current, StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING);
            } catch (IOException | UnsupportedOperationException atomicFailure) {
                Files.move(tmp, current, StandardCopyOption.REPLACE_EXISTING);
            }
            return true;
        } catch (IOException | UnsupportedOperationException | SecurityException e) {
            try {
                Files.deleteIfExists(tmp);
            } catch (IOException ignored) {
                // best-effort cleanup
            }
            return false;
        }
    }

    private void prune() {
        Path builds = buildsDir();
        if (!Files.isDirectory(builds)) {
            return;
        }
        List<Long> ids;
        try (var stream = Files.list(builds)) {
            ids = stream.filter(Files::isDirectory)
                    .map(p -> p.getFileName().toString())
                    .filter(s -> s.chars().allMatch(Character::isDigit))
                    .map(Long::parseLong)
                    .sorted(Comparator.reverseOrder())
                    .toList();
        } catch (IOException e) {
            return;
        }
        long currentId = currentRunId();
        int kept = 0;
        for (Long id : ids) {
            if (id == currentId) {
                continue;
            }
            if (kept < keepBuilds) {
                kept++;
                continue;
            }
            TargetIo.deleteRecursively(buildDir(id));
        }
    }
}
