package com.acme.staticforge.generate.target;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.Comparator;
import java.util.HexFormat;
import java.util.Map;
import java.util.Optional;
import java.util.TreeMap;

/**
 * Shared filesystem helpers for the {@link TargetWriter} implementations. All paths are resolved
 * relative to an already-normalized root and verified to never escape it (§26.3).
 */
final class TargetIo {

    private TargetIo() {}

    static boolean isWindows() {
        return System.getProperty("os.name", "").toLowerCase().contains("win");
    }

    /**
     * Resolves {@code relativePath} under {@code root}, rejecting any {@code ..}/{@code .} escape.
     * {@code relativePath} is expected to already be normalized by {@code OutputFile.normalize}.
     */
    static Path resolve(Path root, String relativePath) {
        Path resolved = root.resolve(relativePath).normalize();
        if (!resolved.startsWith(root)) {
            throw new IllegalArgumentException("Output path escapes target root: " + relativePath);
        }
        return resolved;
    }

    static void write(Path file, byte[] bytes) {
        try {
            Path parent = file.getParent();
            if (parent != null) {
                Files.createDirectories(parent);
            }
            Files.write(file, bytes);
        } catch (IOException e) {
            throw new java.io.UncheckedIOException("Failed to write " + file, e);
        }
    }

    static void deleteRecursively(Path path) {
        if (path == null || !Files.exists(path)) {
            return;
        }
        try (var stream = Files.walk(path)) {
            stream.sorted(Comparator.reverseOrder()).forEach(p -> {
                try {
                    Files.delete(p);
                } catch (IOException ignored) {
                    // best-effort cleanup
                }
            });
        } catch (IOException ignored) {
            // best-effort cleanup
        }
    }

    /** SHA-256 hex digest of {@code bytes}, used as a cheap content fingerprint for S3 diffing. */
    static String sha256(byte[] bytes) {
        try {
            MessageDigest md = MessageDigest.getInstance("SHA-256");
            return HexFormat.of().formatHex(md.digest(bytes));
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException("SHA-256 unavailable", e);
        }
    }

    /** The bytes of {@code file}; empty when it isn't a readable regular file. */
    static Optional<byte[]> readIfExists(Path file) {
        if (file == null || !Files.isRegularFile(file)) {
            return Optional.empty();
        }
        try {
            return Optional.of(Files.readAllBytes(file));
        } catch (IOException e) {
            return Optional.empty();
        }
    }

    /**
     * Every regular file under {@code root}, keyed by its normalized relative path (forward slashes), in path order.
     */
    static Map<String, Path> listFiles(Path root) {
        Map<String, Path> files = new TreeMap<>();
        if (!Files.isDirectory(root)) {
            return files;
        }
        try (var stream = Files.walk(root)) {
            stream.filter(Files::isRegularFile)
                    .forEach(file -> files.put(root.relativize(file).toString().replace('\\', '/'), file));
        } catch (IOException e) {
            throw new UncheckedIOException("Failed to list " + root, e);
        }
        return files;
    }

    /**
     * Makes {@code target} a hard link to {@code source}, or a copy where links aren't supported (another file store,
     * a filesystem without links). A carried build shares unchanged files with its base this way; callers must never
     * write into {@code target} afterwards, since that would change the base build too.
     */
    static void linkOrCopy(Path source, Path target) {
        try {
            Path parent = target.getParent();
            if (parent != null) {
                Files.createDirectories(parent);
            }
            try {
                Files.createLink(target, source);
            } catch (IOException | UnsupportedOperationException | SecurityException linkFailure) {
                Files.copy(source, target, StandardCopyOption.REPLACE_EXISTING);
            }
        } catch (IOException e) {
            throw new UncheckedIOException("Failed to carry " + source + " to " + target, e);
        }
    }

    static void writeMarker(Path marker, long runId) {
        write(marker, (String.valueOf(runId) + System.lineSeparator()).getBytes(StandardCharsets.UTF_8));
    }

    /** Reads a {@code current} marker file or symlink target, returning the runId or {@code -1}. */
    static long readRunId(Path current) {
        if (current == null || !Files.exists(current)) {
            return -1L;
        }
        if (Files.isSymbolicLink(current)) {
            try {
                return parseRunId(current.toRealPath());
            } catch (IOException e) {
                return -1L;
            }
        }
        try {
            return Long.parseLong(Files.readString(current).trim());
        } catch (IOException | NumberFormatException e) {
            return -1L;
        }
    }

    private static long parseRunId(Path buildDir) {
        try {
            return Long.parseLong(buildDir.getFileName().toString());
        } catch (NumberFormatException e) {
            return -1L;
        }
    }
}
