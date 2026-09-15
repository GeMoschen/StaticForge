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

    private Path current() {
        return targetRoot.resolve("current");
    }

    @Override
    public void stage(long runId, List<OutputFile> files) {
        Path dir = runDir(runId);
        Map<String, String> fingerprints = new HashMap<>();
        for (OutputFile file : files) {
            Path target = TargetIo.resolve(dir, file.path());
            TargetIo.write(target, file.bytes());
            fingerprints.put(file.path(), TargetIo.sha256(file.bytes()));
        }
        staged.put(runId, Map.copyOf(fingerprints));
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

    /** Returns the NEW/changed keys (invalidation set) computed for {@code runId}, or empty. */
    public Set<String> changedKeys(long runId) {
        return changedKeys.getOrDefault(runId, Set.of());
    }

    /** Returns the runId the {@code current} marker points at, or {@code -1}. */
    public long currentRunId() {
        return TargetIo.readRunId(current());
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
