package com.acme.staticforge.generate.target;

import com.acme.staticforge.generate.pipeline.OutputFile;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;

/**
 * S3 target writer — a dependency-free <em>local mirror</em> stub (spec §18.4 "no CDN
 * provisioning").
 *
 * <p><b>Documented design (single-node v1):</b> real S3 upload and CDN invalidation are a
 * config/runbook concern and are intentionally out of scope. This stub simulates the write by
 * mirroring keys under {@code {targetRoot}/{runId}/...} and records the set of
 * <em>NEW or changed</em> keys (the invalidation set) on {@code publish} by diffing each key's
 * SHA-256 fingerprint against the previously published run's manifest. {@code promote} re-points
 * the {@code current} marker at a prior runId.
 *
 * <p>A carried build (M22.4.1) mirrors the base run's keys that are neither removed nor overwritten (hard links where
 * possible) and takes their fingerprints from the base run's key manifest, so the new run's key manifest is complete
 * and the invalidation set only names what actually changed. The build manifest is {@code {runId}.manifest.json}.
 */
public final class S3TargetWriter implements TargetWriter {

    private final Path targetRoot;

    private final Map<Long, Map<String, String>> staged = new ConcurrentHashMap<>();
    private final Map<Long, Set<String>> changedKeys = new ConcurrentHashMap<>();

    public S3TargetWriter(Path targetRoot) {
        this.targetRoot = targetRoot.toAbsolutePath().normalize();
    }

    private Path runDir(long runId) {
        return targetRoot.resolve(String.valueOf(runId));
    }

    private Path manifest(long runId) {
        return targetRoot.resolve(String.valueOf(runId) + ".keys");
    }

    private Path buildManifest(long runId) {
        return targetRoot.resolve(runId + ".manifest.json");
    }

    private Path current() {
        return targetRoot.resolve("current");
    }

    @Override
    public void stage(long runId, List<OutputFile> files) {
        staged.put(runId, Map.copyOf(writeKeys(runId, files, new HashMap<>())));
    }

    @Override
    public void stage(long runId, long baseRunId, List<OutputFile> files, Set<String> removedPaths) {
        Path base = runDir(baseRunId);
        if (!Files.isDirectory(base) || !Files.isRegularFile(manifest(baseRunId))) {
            throw new IllegalStateException("No S3 mirror exists for base run " + baseRunId);
        }
        Set<String> overlaid = new HashSet<>();
        files.forEach(file -> overlaid.add(file.path()));
        Map<String, String> fingerprints = new HashMap<>();
        for (Map.Entry<String, String> key : loadManifest(baseRunId).entrySet()) {
            if (overlaid.contains(key.getKey()) || removedPaths.contains(key.getKey())) {
                continue;
            }
            TargetIo.linkOrCopy(TargetIo.resolve(base, key.getKey()), TargetIo.resolve(runDir(runId), key.getKey()));
            fingerprints.put(key.getKey(), key.getValue());
        }
        staged.put(runId, Map.copyOf(writeKeys(runId, files, fingerprints)));
    }

    private Map<String, String> writeKeys(long runId, List<OutputFile> files, Map<String, String> fingerprints) {
        Path dir = runDir(runId);
        try {
            Files.createDirectories(dir);
        } catch (IOException e) {
            throw new java.io.UncheckedIOException("Failed to create mirror directory " + dir, e);
        }
        for (OutputFile file : files) {
            Path target = TargetIo.resolve(dir, file.path());
            TargetIo.write(target, file.bytes());
            fingerprints.put(file.path(), TargetIo.sha256(file.bytes()));
        }
        return fingerprints;
    }

    @Override
    public void writeManifest(long runId, BuildManifest manifest) {
        TargetIo.write(buildManifest(runId), manifest.toJson());
    }

    @Override
    public void writeSidecar(long runId, String name, byte[] bytes) {
        TargetIo.write(TargetIo.sidecarFile(targetRoot, runId, name), bytes);
    }

    @Override
    public Optional<byte[]> readSidecar(long runId, String name) {
        if (runId < 0 || !Files.isDirectory(runDir(runId))) {
            return Optional.empty();
        }
        return TargetIo.readIfExists(TargetIo.sidecarFile(targetRoot, runId, name));
    }

    @Override
    public Optional<BuildManifest> readManifest(long runId) {
        if (runId < 0 || !Files.isDirectory(runDir(runId))) {
            return Optional.empty();
        }
        return TargetIo.readIfExists(buildManifest(runId)).flatMap(BuildManifest::parse);
    }

    @Override
    public Optional<byte[]> readFile(long runId, String path) {
        if (runId < 0) {
            return Optional.empty();
        }
        return TargetIo.readIfExists(TargetIo.resolve(runDir(runId), OutputFile.normalize(path)));
    }

    @Override
    public void publish(long runId) {
        Map<String, String> fingerprints = staged.get(runId);
        if (fingerprints == null || !Files.isDirectory(runDir(runId))) {
            throw new IllegalStateException("No staged S3 mirror for run " + runId);
        }
        Map<String, String> previous = loadManifest(TargetIo.readRunId(current()));
        Set<String> changed = new HashSet<>();
        for (Map.Entry<String, String> e : fingerprints.entrySet()) {
            if (!e.getValue().equals(previous.get(e.getKey()))) {
                changed.add(e.getKey());
            }
        }
        writeManifest(runId, fingerprints);
        TargetIo.writeMarker(current(), runId);
        changedKeys.put(runId, Set.copyOf(changed));
    }

    @Override
    public void promote(long runId) {
        if (!Files.isRegularFile(manifest(runId))) {
            throw new IllegalStateException("No prior S3 mirror exists for run " + runId);
        }
        TargetIo.writeMarker(current(), runId);
    }

    @Override
    public String describe() {
        return "s3 (local mirror) target at " + targetRoot;
    }

    /** The published mirrors ({@code {runId}/} with a key manifest) and the current one (M29.3.1). */
    @Override
    public Set<Long> retainedRunIds() {
        Set<Long> ids = new java.util.TreeSet<>();
        try (var stream = Files.list(targetRoot)) {
            stream.map(p -> TargetIo.leadingRunId(p.getFileName().toString(), ".keys"))
                    .filter(id -> id >= 0 && Files.isDirectory(runDir(id)))
                    .forEach(ids::add);
        } catch (IOException e) {
            return ids;
        }
        long currentId = currentRunId();
        if (currentId >= 0 && Files.isDirectory(runDir(currentId))) {
            ids.add(currentId);
        }
        return ids;
    }

    /** Cleanup of the local mirror is not supported (M29.2.2: it follows when this writer uploads to real buckets). */
    @Override
    public List<StoredItem> storedItems() {
        return List.of();
    }

    @Override
    public long sizeOf(StoredItem item) {
        return TargetIo.sizeOf(item.path());
    }

    @Override
    public void delete(StoredItem item) {
        throw new UnsupportedOperationException("The S3 local mirror is not cleaned up");
    }

    /** Returns the NEW/changed keys (invalidation set) computed for {@code runId}, or empty. */
    public Set<String> changedKeys(long runId) {
        return changedKeys.getOrDefault(runId, Set.of());
    }

    /** Returns the runId the {@code current} marker points at, or {@code -1}. */
    @Override
    public long currentRunId() {
        return TargetIo.readRunId(current());
    }

    /** The published keys of {@code runId} with their fingerprints; empty when the run has no key manifest. */
    public Map<String, String> keys(long runId) {
        return loadManifest(runId);
    }

    private Map<String, String> loadManifest(long runId) {
        Path manifest = manifest(runId);
        if (runId < 0 || !Files.isRegularFile(manifest)) {
            return Map.of();
        }
        Map<String, String> result = new HashMap<>();
        try {
            for (String line : Files.readAllLines(manifest)) {
                int tab = line.indexOf('\t');
                if (tab > 0) {
                    result.put(line.substring(0, tab), line.substring(tab + 1));
                }
            }
        } catch (IOException e) {
            return Map.of();
        }
        return result;
    }

    private void writeManifest(long runId, Map<String, String> fingerprints) {
        StringBuilder sb = new StringBuilder();
        fingerprints.entrySet().stream()
                .sorted(Map.Entry.comparingByKey())
                .forEach(e -> sb.append(e.getKey()).append('\t').append(e.getValue()).append('\n'));
        TargetIo.write(manifest(runId), sb.toString().getBytes(StandardCharsets.UTF_8));
    }
}
