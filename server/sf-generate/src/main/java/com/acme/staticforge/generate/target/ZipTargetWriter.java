package com.acme.staticforge.generate.target;

import com.acme.staticforge.generate.pipeline.OutputFile;
import java.io.IOException;
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.HashSet;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.TreeSet;
import java.util.zip.ZipEntry;
import java.util.zip.ZipFile;
import java.util.zip.ZipOutputStream;

/**
 * ZIP target writer (spec §18.4). Streams all files into {@code {outputRoot}/builds/{runId}.zip}
 * using the JDK {@code java.util.zip} package (no third-party zip library). {@code publish}
 * finalizes the staged archive (temp-&gt;final rename) and points a {@code current} marker at the
 * runId; {@code promote} re-points that same marker at a prior run's archive.
 *
 * <p>Each entry is named by the normalized relative path and written as UTF-8 bytes. A carried build (M22.4.1) is a
 * new archive holding the base archive's entries that are neither removed nor overwritten, then the run's files; the
 * manifest is {@code builds/{runId}.manifest.json}.
 *
 * <p><b>Published builds (M29.2.2):</b> a run stages {@code {runId}.zip.tmp} and only {@link #publish} renames it to
 * {@code {runId}.zip}, so every {@code .zip} is a published build: {@code keep-builds} counts those and never an
 * unpublished {@code .zip.tmp}, which is left to {@code build-output-cleanup}.
 */
public final class ZipTargetWriter implements TargetWriter {

    private final Path outputRoot;
    private final int keepBuilds;

    public ZipTargetWriter(Path outputRoot, int keepBuilds) {
        this.outputRoot = outputRoot.toAbsolutePath().normalize();
        this.keepBuilds = Math.max(keepBuilds, 1);
    }

    private Path buildsDir() {
        return outputRoot.resolve("builds");
    }

    private Path zipFile(long runId) {
        return buildsDir().resolve(String.valueOf(runId) + ".zip");
    }

    private Path tmpFile(long runId) {
        return buildsDir().resolve(String.valueOf(runId) + ".zip.tmp");
    }

    private Path manifestFile(long runId) {
        return buildsDir().resolve(runId + ".manifest.json");
    }

    private Path current() {
        return outputRoot.resolve("current");
    }

    @Override
    public void stage(long runId, List<OutputFile> files) {
        writeArchive(runId, null, files, Set.of());
    }

    @Override
    public void stage(long runId, long baseRunId, List<OutputFile> files, Set<String> removedPaths) {
        Path base = zipFile(baseRunId);
        if (!Files.isRegularFile(base)) {
            throw new IllegalStateException("Base zip does not exist: " + base);
        }
        writeArchive(runId, base, files, removedPaths);
    }

    private void writeArchive(long runId, Path base, List<OutputFile> files, Set<String> removedPaths) {
        Path tmp = tmpFile(runId);
        Set<String> overlaid = new HashSet<>();
        files.forEach(file -> overlaid.add(file.path()));
        try {
            Files.createDirectories(tmp.getParent());
            try (var out = new ZipOutputStream(Files.newOutputStream(tmp))) {
                if (base != null) {
                    try (ZipFile zip = new ZipFile(base.toFile())) {
                        for (ZipEntry carried : Collections.list(zip.entries())) {
                            String name = carried.getName();
                            if (carried.isDirectory() || overlaid.contains(name) || removedPaths.contains(name)) {
                                continue;
                            }
                            out.putNextEntry(entry(name));
                            try (InputStream in = zip.getInputStream(carried)) {
                                in.transferTo(out);
                            }
                            out.closeEntry();
                        }
                    }
                }
                for (OutputFile file : files) {
                    out.putNextEntry(entry(file.path()));
                    out.write(file.bytes());
                    out.closeEntry();
                }
            }
        } catch (IOException e) {
            throw new java.io.UncheckedIOException("Failed to stage zip " + tmp, e);
        }
    }

    private static ZipEntry entry(String path) {
        ZipEntry entry = new ZipEntry(path);
        entry.setTime(java.time.Instant.now().toEpochMilli());
        return entry;
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
        if (runId < 0 || !Files.isRegularFile(zipFile(runId))) {
            return Optional.empty();
        }
        return TargetIo.readIfExists(TargetIo.sidecarFile(buildsDir(), runId, name));
    }

    @Override
    public Optional<BuildManifest> readManifest(long runId) {
        if (runId < 0 || !Files.isRegularFile(zipFile(runId))) {
            return Optional.empty();
        }
        return TargetIo.readIfExists(manifestFile(runId)).flatMap(BuildManifest::parse);
    }

    @Override
    public Optional<byte[]> readFile(long runId, String path) {
        Path archive = zipFile(runId);
        if (runId < 0 || !Files.isRegularFile(archive)) {
            return Optional.empty();
        }
        try (ZipFile zip = new ZipFile(archive.toFile())) {
            ZipEntry entry = zip.getEntry(OutputFile.normalize(path));
            if (entry == null) {
                return Optional.empty();
            }
            try (InputStream in = zip.getInputStream(entry)) {
                return Optional.of(in.readAllBytes());
            }
        } catch (IOException e) {
            return Optional.empty();
        }
    }

    @Override
    public void publish(long runId) {
        Path tmp = tmpFile(runId);
        Path zip = zipFile(runId);
        if (!Files.isRegularFile(tmp)) {
            throw new IllegalStateException("Staged zip does not exist: " + tmp);
        }
        try {
            Files.move(tmp, zip, StandardCopyOption.REPLACE_EXISTING);
            Files.createDirectories(outputRoot);
        } catch (IOException e) {
            throw new java.io.UncheckedIOException("Failed to finalize zip " + zip, e);
        }
        TargetIo.writeMarker(current(), runId);
        prune();
    }

    @Override
    public void promote(long runId) {
        Path zip = zipFile(runId);
        if (!Files.isRegularFile(zip)) {
            throw new IllegalStateException("No prior zip exists for run " + runId + ": " + zip);
        }
        TargetIo.writeMarker(current(), runId);
    }

    @Override
    public String describe() {
        return "zip target at " + outputRoot;
    }

    /** Returns the runId the {@code current} marker points at, or {@code -1}. */
    @Override
    public long currentRunId() {
        return TargetIo.readRunId(current());
    }

    @Override
    public Set<Long> retainedRunIds() {
        Set<Long> ids = new TreeSet<>(publishedRunIds());
        long currentId = currentRunId();
        if (currentId >= 0 && Files.isRegularFile(zipFile(currentId))) {
            ids.add(currentId);
        }
        return ids;
    }

    @Override
    public List<StoredItem> storedItems() {
        List<StoredItem> items = new ArrayList<>();
        Path builds = buildsDir();
        if (!Files.isDirectory(builds)) {
            return items;
        }
        try (var stream = Files.list(builds)) {
            stream.sorted().forEach(p -> {
                String name = p.getFileName().toString();
                long zip = TargetIo.leadingRunId(name, ".zip");
                long staged = TargetIo.leadingRunId(name, ".zip.tmp");
                long manifest = TargetIo.leadingRunId(name, ".manifest.json");
                long sidecar = TargetIo.sidecarRunId(name);
                if (zip >= 0) {
                    items.add(new StoredItem(StoredItem.Kind.BUILD, zip, p, TargetIo.modified(p)));
                } else if (staged >= 0) {
                    items.add(new StoredItem(StoredItem.Kind.STAGED, staged, p, TargetIo.modified(p)));
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

    /** The finished archives, newest first. */
    private List<Long> publishedRunIds() {
        Path builds = buildsDir();
        if (!Files.isDirectory(builds)) {
            return List.of();
        }
        try (var stream = Files.list(builds)) {
            return stream.filter(Files::isRegularFile)
                    .map(p -> TargetIo.leadingRunId(p.getFileName().toString(), ".zip"))
                    .filter(id -> id >= 0)
                    .sorted(Comparator.reverseOrder())
                    .toList();
        } catch (IOException e) {
            return List.of();
        }
    }

    /** Keeps {@code current} and the newest {@code keepBuilds} published archives; staged ones are not counted. */
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
            try {
                Files.deleteIfExists(zipFile(id));
                Files.deleteIfExists(manifestFile(id));
                TargetIo.deleteSidecars(buildsDir(), id);
            } catch (IOException ignored) {
                // best-effort cleanup
            }
        }
    }
}
