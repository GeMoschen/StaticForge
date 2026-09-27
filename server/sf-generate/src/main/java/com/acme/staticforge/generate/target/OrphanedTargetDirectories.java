package com.acme.staticforge.generate.target;

import com.acme.staticforge.generate.TargetLocations;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.Path;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Collection;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.regex.Pattern;
import java.util.stream.Collectors;
import java.util.stream.Stream;

/**
 * Output directories of deleted targets (M29.2.2): {@code TargetController.delete} removes only the row, so the
 * target's {@code {outputRoot}/{projectKey}/{path}} directory stays behind. Ownership follows spec §18.4 and
 * {@link TargetLocations}: an existing target owns its {@code config.path} or {@code target-{id}}, compared
 * case-insensitively like {@link TargetLocations#overlaps}. A directory under a project's folder that no target owns,
 * that is no ancestor of an owned path and that looks like target output ({@code current}, {@code builds/},
 * {@code target-<n>} or an S3 key manifest) is orphaned. Anything else — and the legacy shared-root layout, which
 * {@link LegacyOutputCleanup} handles — is left alone.
 */
public final class OrphanedTargetDirectories {

    private static final Pattern DEFAULT_TARGET_DIR = Pattern.compile("target-\\d+");

    private OrphanedTargetDirectories() {}

    /**
     * The orphaned target directories of project {@code projectKey}, last modified before {@code olderThan}.
     *
     * @param ownedPaths the relative paths of the project's existing targets ({@link TargetLocations#relativePath})
     */
    public static List<Path> find(Path outputRoot, String projectKey, Collection<String> ownedPaths, Instant olderThan) {
        Path projectDir = projectDir(outputRoot, projectKey);
        List<Path> orphans = new ArrayList<>();
        if (!Files.isDirectory(projectDir, LinkOption.NOFOLLOW_LINKS)) {
            return orphans;
        }
        Set<String> owned = ownedPaths.stream().map(p -> p.toLowerCase(Locale.ROOT)).collect(Collectors.toSet());
        collect(projectDir, "", owned, olderThan, orphans);
        return orphans;
    }

    /** The bytes under {@code dir}, links not followed. */
    public static long sizeOf(Path dir) {
        return TargetIo.sizeOf(dir);
    }

    /**
     * Deletes the orphaned directory {@code dir} of project {@code projectKey} (links as links).
     *
     * @throws IllegalArgumentException when {@code dir} is not inside the project's output folder
     */
    public static void delete(Path outputRoot, String projectKey, Path dir) {
        TargetIo.deleteUnder(projectDir(outputRoot, projectKey), dir);
    }

    private static Path projectDir(Path outputRoot, String projectKey) {
        Path root = outputRoot.toAbsolutePath().normalize();
        return TargetIo.resolve(root, projectKey);
    }

    private static void collect(Path dir, String relative, Set<String> owned, Instant olderThan, List<Path> orphans) {
        List<Path> children;
        try (Stream<Path> stream = Files.list(dir)) {
            children = stream.filter(p -> Files.isDirectory(p, LinkOption.NOFOLLOW_LINKS)).sorted().toList();
        } catch (IOException e) {
            return;
        }
        for (Path child : children) {
            String path = relative.isEmpty()
                    ? child.getFileName().toString()
                    : relative + "/" + child.getFileName().toString();
            String key = path.toLowerCase(Locale.ROOT);
            if (owned.contains(key)) {
                continue;
            }
            if (owned.stream().anyMatch(o -> o.startsWith(key + "/"))) {
                collect(child, path, owned, olderThan, orphans);
            } else if (looksLikeTargetOutput(child) && TargetIo.modified(child).isBefore(olderThan)) {
                orphans.add(child);
            }
        }
    }

    private static boolean looksLikeTargetOutput(Path dir) {
        if (DEFAULT_TARGET_DIR.matcher(dir.getFileName().toString()).matches()) {
            return true;
        }
        if (Files.exists(dir.resolve("current"), LinkOption.NOFOLLOW_LINKS)
                || Files.isDirectory(dir.resolve("builds"), LinkOption.NOFOLLOW_LINKS)) {
            return true;
        }
        try (Stream<Path> stream = Files.list(dir)) {
            return stream.anyMatch(p -> TargetIo.leadingRunId(p.getFileName().toString(), ".keys") >= 0);
        } catch (IOException e) {
            return false;
        }
    }
}
