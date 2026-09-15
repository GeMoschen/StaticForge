package com.acme.staticforge.generate;

import com.fasterxml.jackson.databind.JsonNode;
import java.nio.file.Path;
import java.util.Locale;
import java.util.Optional;
import java.util.regex.Pattern;

/**
 * Resolves where a {@link GenerationTarget} writes (spec §18.4). Every target owns its own
 * directory {@code {outputRoot}/{projectKey}/{path}}, where {@code path} is the target's
 * {@code config.path} or, when unset, {@code target-{id}}. Distinct projects therefore never
 * share a {@code current} pointer or a build-retention pool, and within a project two targets
 * may not share, nest in, or contain each other's directory (checked by {@link #overlaps}).
 */
public final class TargetLocations {

    /** Config key holding the target's directory relative to its project's output folder. */
    public static final String PATH_KEY = "path";

    private static final int MAX_PATH_LENGTH = 200;
    private static final Pattern SEGMENT = Pattern.compile("[A-Za-z0-9._-]+");
    private static final Pattern RESERVED_SEGMENT = Pattern.compile("target-\\d+");

    private TargetLocations() {}

    /**
     * Validates and normalizes a user-supplied {@code config.path}. Returns empty for a
     * missing/blank path (the {@code target-{id}} default applies).
     *
     * @throws IllegalArgumentException with a user-facing message when the path is invalid
     */
    public static Optional<String> configuredPath(JsonNode config) {
        JsonNode node = config == null ? null : config.get(PATH_KEY);
        if (node == null || node.isNull()) {
            return Optional.empty();
        }
        if (!node.isTextual()) {
            throw new IllegalArgumentException("Target path must be a string.");
        }
        String raw = node.asText().trim().replace('\\', '/');
        while (raw.endsWith("/")) {
            raw = raw.substring(0, raw.length() - 1);
        }
        if (raw.isEmpty()) {
            return Optional.empty();
        }
        if (raw.length() > MAX_PATH_LENGTH) {
            throw new IllegalArgumentException("Target path must be at most " + MAX_PATH_LENGTH + " characters.");
        }
        if (raw.startsWith("/")) {
            throw new IllegalArgumentException("Target path must be relative to the project's output folder.");
        }
        String[] segments = raw.split("/");
        for (String segment : segments) {
            if (segment.isEmpty() || segment.equals(".") || segment.equals("..") || !SEGMENT.matcher(segment).matches()) {
                throw new IllegalArgumentException(
                        "Target path segments may only contain letters, digits, '.', '_' and '-' (no '.' or '..').");
            }
        }
        if (RESERVED_SEGMENT.matcher(segments[0]).matches()) {
            throw new IllegalArgumentException("Target paths starting with 'target-<number>' are reserved.");
        }
        return Optional.of(raw);
    }

    /** The target's directory relative to its project's output folder ({@code config.path} or {@code target-{id}}). */
    public static String relativePath(GenerationTarget target) {
        return configuredPath(target.getConfig()).orElseGet(() -> "target-" + target.getId());
    }

    /** The target's directory relative to the server output root, e.g. {@code acme/site}. */
    public static String outputPath(String projectKey, GenerationTarget target) {
        return projectKey + "/" + relativePath(target);
    }

    /** Absolute, normalized directory the target writes into; never escapes {@code outputRoot}. */
    public static Path resolve(Path outputRoot, String projectKey, GenerationTarget target) {
        Path root = outputRoot.toAbsolutePath().normalize();
        Path dir = root.resolve(outputPath(projectKey, target)).normalize();
        if (!dir.startsWith(root) || dir.equals(root)) {
            throw new IllegalArgumentException("Target directory escapes the output root: " + dir);
        }
        return dir;
    }

    /**
     * True when two relative target paths are equal or one is an ancestor of the other. Compared
     * case-insensitively because the output root may live on a case-insensitive filesystem.
     */
    public static boolean overlaps(String a, String b) {
        String x = a.toLowerCase(Locale.ROOT);
        String y = b.toLowerCase(Locale.ROOT);
        return x.equals(y) || x.startsWith(y + "/") || y.startsWith(x + "/");
    }
}
