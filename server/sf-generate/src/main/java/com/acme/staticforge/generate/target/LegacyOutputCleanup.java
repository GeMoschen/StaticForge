package com.acme.staticforge.generate.target;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.function.Predicate;
import java.util.regex.Pattern;
import java.util.stream.Stream;

/**
 * Removes output left behind by the pre-per-target layout, where every project published straight
 * into the shared output root: {@code {root}/builds/{runId}[.zip]}, {@code {root}/current} and
 * {@code {root}/s3/{targetName}/...}. Current output lives under {@code {root}/{projectKey}/...}
 * (see {@code TargetLocations}).
 *
 * <p>Project keys may legally be {@code builds}, {@code current} or {@code s3}, so an entry is only
 * treated as legacy when no project owns that key <em>and</em> its contents match the old layout
 * exactly. Anything else is left untouched.
 */
public final class LegacyOutputCleanup {

    private static final Pattern RUN_DIR = Pattern.compile("\\d+");
    private static final Pattern ZIP_BUILD = Pattern.compile("\\d+\\.zip(\\.tmp)?");
    private static final Pattern S3_MANIFEST = Pattern.compile("\\d+\\.keys");

    private LegacyOutputCleanup() {}

    /**
     * Deletes recognized legacy entries directly under {@code outputRoot}.
     *
     * @param isProjectKey whether a project (archived or not) owns the given key
     * @return the entries that were removed
     */
    public static List<Path> run(Path outputRoot, Predicate<String> isProjectKey) {
        Path root = outputRoot.toAbsolutePath().normalize();
        List<Path> removed = new ArrayList<>();
        if (!Files.isDirectory(root)) {
            return removed;
        }

        Path current = root.resolve("current");
        if (!isProjectKey.test("current") && isLegacyMarker(current)) {
            delete(current, removed);
        }

        Path builds = root.resolve("builds");
        if (!isProjectKey.test("builds")
                && isPlainDirectory(builds)
                && allChildrenMatch(builds, LegacyOutputCleanup::isLegacyBuild)) {
            delete(builds, removed);
        }

        Path s3 = root.resolve("s3");
        if (!isProjectKey.test("s3")
                && isPlainDirectory(s3)
                && allChildrenMatch(s3, mirror -> isPlainDirectory(mirror)
                        && allChildrenMatch(mirror, LegacyOutputCleanup::isLegacyS3Entry))) {
            delete(s3, removed);
        }
        return removed;
    }

    /** {@code current} was a marker file or a symlink, never a real directory. */
    private static boolean isLegacyMarker(Path path) {
        return Files.isSymbolicLink(path) || Files.isRegularFile(path, LinkOption.NOFOLLOW_LINKS);
    }

    private static boolean isLegacyBuild(Path entry) {
        String name = entry.getFileName().toString();
        return (isPlainDirectory(entry) && RUN_DIR.matcher(name).matches())
                || (Files.isRegularFile(entry, LinkOption.NOFOLLOW_LINKS) && ZIP_BUILD.matcher(name).matches());
    }

    private static boolean isLegacyS3Entry(Path entry) {
        String name = entry.getFileName().toString();
        return (isPlainDirectory(entry) && RUN_DIR.matcher(name).matches())
                || (Files.isRegularFile(entry, LinkOption.NOFOLLOW_LINKS)
                        && (S3_MANIFEST.matcher(name).matches() || name.equals("current")));
    }

    private static boolean isPlainDirectory(Path path) {
        return Files.isDirectory(path, LinkOption.NOFOLLOW_LINKS);
    }

    private static boolean allChildrenMatch(Path dir, Predicate<Path> predicate) {
        try (Stream<Path> children = Files.list(dir)) {
            return children.allMatch(predicate);
        } catch (IOException e) {
            return false;
        }
    }

    private static void delete(Path path, List<Path> removed) {
        if (Files.isSymbolicLink(path)) {
            try {
                Files.delete(path);
            } catch (IOException ignored) {
                // reported below as not removed
            }
        } else {
            TargetIo.deleteRecursively(path);
        }
        if (!Files.exists(path, LinkOption.NOFOLLOW_LINKS)) {
            removed.add(path);
        }
    }
}
