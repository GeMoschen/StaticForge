package com.acme.staticforge.generate.target;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.security.MessageDigest;
import java.nio.file.attribute.BasicFileAttributes;
import java.security.NoSuchAlgorithmException;
import java.time.Instant;
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
        if (path == null || !Files.exists(path, LinkOption.NOFOLLOW_LINKS)) {
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

    /**
     * Deletes {@code path} under {@code root} (M29.2.2): a link as a link, a directory recursively without following
     * the links inside it (a hard-linked file loses one link; the data stays for the builds that share it).
     *
     * @throws IllegalArgumentException when {@code path} is not strictly inside {@code root} (spec §26.3)
     */
    static void deleteUnder(Path root, Path path) {
        Path normalized = path.toAbsolutePath().normalize();
        if (!normalized.startsWith(root) || normalized.equals(root)) {
            throw new IllegalArgumentException("Refusing to delete " + path + ": not inside " + root);
        }
        if (Files.isSymbolicLink(normalized)) {
            try {
                Files.deleteIfExists(normalized);
            } catch (IOException e) {
                throw new UncheckedIOException("Failed to delete link " + normalized, e);
            }
            return;
        }
        deleteRecursively(normalized);
    }

    /** The bytes of the regular files under {@code path} (or of {@code path}), links not followed and not counted. */
    static long sizeOf(Path path) {
        if (!Files.exists(path, LinkOption.NOFOLLOW_LINKS) || Files.isSymbolicLink(path)) {
            return 0;
        }
        try (var stream = Files.walk(path)) {
            return stream.mapToLong(p -> {
                try {
                    BasicFileAttributes attributes = Files.readAttributes(p, BasicFileAttributes.class, LinkOption.NOFOLLOW_LINKS);
                    return attributes.isRegularFile() ? attributes.size() : 0;
                } catch (IOException e) {
                    return 0;
                }
            }).sum();
        } catch (IOException | UncheckedIOException e) {
            return 0;
        }
    }

    /** The last modification of {@code path} itself (of the link, for a link); the epoch when unreadable. */
    static Instant modified(Path path) {
        try {
            return Files.getLastModifiedTime(path, LinkOption.NOFOLLOW_LINKS).toInstant();
        } catch (IOException e) {
            return Instant.EPOCH;
        }
    }

    /** The run id a build file name starts with ({@code 17}, {@code 17.zip}, {@code 17.manifest.json}), or -1. */
    static long leadingRunId(String name, String suffix) {
        if (!name.endsWith(suffix)) {
            return -1;
        }
        String digits = name.substring(0, name.length() - suffix.length());
        if (digits.isEmpty() || digits.length() > 18 || !digits.chars().allMatch(Character::isDigit)) {
            return -1;
        }
        return Long.parseLong(digits);
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
