package com.acme.staticforge.generate.target;

import com.acme.staticforge.generate.pipeline.OutputFile;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.util.Comparator;
import java.util.List;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;

/**
 * ZIP target writer (spec §18.4). Streams all files into {@code {outputRoot}/builds/{runId}.zip}
 * using the JDK {@code java.util.zip} package (no third-party zip library). {@code publish}
 * finalizes the staged archive (temp-&gt;final rename) and points a {@code current} marker at the
 * runId; {@code promote} re-points that same marker at a prior run's archive.
 *
 * <p>Each entry is named by the normalized relative path and written as UTF-8 bytes.
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

    private Path current() {
        return outputRoot.resolve("current");
    }

    @Override
    public void stage(long runId, List<OutputFile> files) {
        Path tmp = tmpFile(runId);
        try {
            Files.createDirectories(tmp.getParent());
            try (var out = new ZipOutputStream(Files.newOutputStream(tmp))) {
                for (OutputFile file : files) {
                    ZipEntry entry = new ZipEntry(file.path());
                    entry.setTime(java.time.Instant.now().toEpochMilli());
                    out.putNextEntry(entry);
                    out.write(file.bytes());
                    out.closeEntry();
                }
            }
        } catch (IOException e) {
            throw new java.io.UncheckedIOException("Failed to stage zip " + tmp, e);
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
    public long currentRunId() {
        return TargetIo.readRunId(current());
    }

    private void prune() {
        Path builds = buildsDir();
        if (!Files.isDirectory(builds)) {
            return;
        }
        List<Long> ids;
        try (var stream = Files.list(builds)) {
            ids = stream.filter(p -> p.getFileName().toString().endsWith(".zip"))
                    .map(p -> p.getFileName().toString())
                    .map(name -> name.substring(0, name.length() - ".zip".length()))
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
            try {
                Files.deleteIfExists(zipFile(id));
            } catch (IOException ignored) {
                // best-effort cleanup
            }
        }
    }
}
