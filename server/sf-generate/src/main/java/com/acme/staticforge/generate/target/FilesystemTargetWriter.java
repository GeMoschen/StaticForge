package com.acme.staticforge.generate.target;

import com.acme.staticforge.generate.pipeline.OutputFile;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.TreeSet;
import java.util.regex.Pattern;

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
 *
 * <p><b>Carried builds (M22.4.1):</b> the base build's unchanged files are hard-linked into the new build directory
 * (copied where the file store has no links), and the run's own files are written as new files, never into a linked
 * one. The manifest is stored as {@code builds/{runId}.manifest.json}, outside the served directory, and pruned with
 * its build.
 *
 * <p><b>Published builds (M29.2.2):</b> the manifest is written right before a build is published, so a build
 * directory with a manifest is a published build and one without is staged output of a run that never published (or
 * a build from before M22). {@code keep-builds} counts published builds only: {@link #publish} keeps {@code current}
 * and the newest {@code keep-builds} published builds and never touches unpublished ones — those are
 * {@code build-output-cleanup}'s, which knows the runs.
 */
public final class FilesystemTargetWriter implements TargetWriter {

    private static final Pattern TEMP_LINK = Pattern.compile("\\.current-\\d+\\.link");

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

    private Path manifestFile(long runId) {
        return buildsDir().resolve(runId + ".manifest.json");
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
    public void stage(long runId, long baseRunId, List<OutputFile> files, Set<String> removedPaths) {
        Path base = buildDir(baseRunId);
        if (!Files.isDirectory(base)) {
            throw new IllegalStateException("Base build directory does not exist: " + base);
        }
        Path build = buildDir(runId);
        Set<String> overlaid = new HashSet<>();
        files.forEach(file -> overlaid.add(file.path()));
        for (Map.Entry<String, Path> carried : TargetIo.listFiles(base).entrySet()) {
            if (!overlaid.contains(carried.getKey()) && !removedPaths.contains(carried.getKey())) {
                TargetIo.linkOrCopy(carried.getValue(), TargetIo.resolve(build, carried.getKey()));
            }
        }
        stage(runId, files);
    }

    @Override
    public void writeManifest(long runId, BuildManifest manifest) {
        TargetIo.write(manifestFile(runId), manifest.toJson());
    }

    @Override
    public void writeSidecar(long runId, String name, byte[] bytes) {
        TargetIo.write(TargetIo.sidecarFile(buildsDir(), runId, name), bytes);
    }

    @Override
    public Optional<byte[]> readSidecar(long runId, String name) {
        if (runId < 0 || !Files.isDirectory(buildDir(runId))) {
            return Optional.empty();
        }
        return TargetIo.readIfExists(TargetIo.sidecarFile(buildsDir(), runId, name));
    }

    @Override
    public Optional<BuildManifest> readManifest(long runId) {
        if (runId < 0 || !Files.isDirectory(buildDir(runId))) {
            return Optional.empty();
        }
        return TargetIo.readIfExists(manifestFile(runId)).flatMap(BuildManifest::parse);
    }

    @Override
    public Optional<byte[]> readFile(long runId, String path) {
        if (runId < 0) {
            return Optional.empty();
        }
        return TargetIo.readIfExists(TargetIo.resolve(buildDir(runId), OutputFile.normalize(path)));
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

    /** Returns the runId {@code current} points at, or {@code -1} when unpublished. */
    @Override
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

    @Override
    public Set<Long> retainedRunIds() {
        Set<Long> ids = new TreeSet<>(publishedRunIds());
        long currentId = currentRunId();
        if (currentId >= 0 && Files.isDirectory(buildDir(currentId))) {
            ids.add(currentId);
        }
        return ids;
    }

    @Override
    public List<StoredItem> storedItems() {
        List<StoredItem> items = new ArrayList<>();
        try (var stream = Files.list(outputRoot)) {
            stream.filter(p -> TEMP_LINK.matcher(p.getFileName().toString()).matches())
                    .forEach(p -> items.add(new StoredItem(StoredItem.Kind.TEMP_LINK, -1, p, TargetIo.modified(p))));
        } catch (IOException e) {
            // no output root yet: nothing stored
        }
        Path builds = buildsDir();
        if (!Files.isDirectory(builds)) {
            return items;
        }
        try (var stream = Files.list(builds)) {
            stream.sorted().forEach(p -> {
                String name = p.getFileName().toString();
                long build = TargetIo.leadingRunId(name, "");
                long manifest = TargetIo.leadingRunId(name, ".manifest.json");
                long sidecar = TargetIo.sidecarRunId(name);
                if (build >= 0 && Files.isDirectory(p, LinkOption.NOFOLLOW_LINKS)) {
                    items.add(new StoredItem(StoredItem.Kind.BUILD, build, p, TargetIo.modified(p)));
                } else if (manifest >= 0) {
                    items.add(new StoredItem(StoredItem.Kind.MANIFEST, manifest, p, TargetIo.modified(p)));
                } else if (sidecar >= 0) {
                    items.add(new StoredItem(StoredItem.Kind.SIDECAR, sidecar, p, TargetIo.modified(p)));
                }
            });
        } catch (IOException e) {
            throw new java.io.UncheckedIOException("Failed to list " + builds, e);
        }
        return items;
    }

    @Override
    public long sizeOf(StoredItem item) {
        return TargetIo.sizeOf(item.path());
    }

    @Override
    public void delete(StoredItem item) {
        if (item.kind() == StoredItem.Kind.BUILD && item.runId() == currentRunId()) {
            throw new IllegalArgumentException("Refusing to delete the current build " + item.path());
        }
        TargetIo.deleteUnder(outputRoot, item.path());
    }

    /** The builds with a manifest, newest first. */
    private List<Long> publishedRunIds() {
        Path builds = buildsDir();
        if (!Files.isDirectory(builds)) {
            return List.of();
        }
        try (var stream = Files.list(builds)) {
            return stream.filter(p -> Files.isDirectory(p, LinkOption.NOFOLLOW_LINKS))
                    .map(p -> TargetIo.leadingRunId(p.getFileName().toString(), ""))
                    .filter(id -> id >= 0 && Files.isRegularFile(manifestFile(id)))
                    .sorted(Comparator.reverseOrder())
                    .toList();
        } catch (IOException e) {
            return List.of();
        }
    }

    /** Keeps {@code current} and the newest {@code keepBuilds} published builds; unpublished builds are not counted. */
    private void prune() {
        List<Long> ids = publishedRunIds();
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
            try {
                Files.deleteIfExists(manifestFile(id));
                TargetIo.deleteSidecars(buildsDir(), id);
            } catch (IOException ignored) {
                // best-effort cleanup
            }
        }
    }
}
