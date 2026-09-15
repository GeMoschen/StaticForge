package com.acme.staticforge.generate.target;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Set;
import java.util.function.Predicate;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

class LegacyOutputCleanupTest {

    private static final Predicate<String> NO_PROJECTS = key -> false;

    @TempDir
    Path root;

    @Test
    void removesFilesystemZipAndS3LegacyLayout() throws IOException {
        file("builds/41/index.html");
        file("builds/42/assets/app.js");
        file("builds/43.zip");
        file("builds/44.zip.tmp");
        file("current");
        file("s3/default/7/index.html");
        file("s3/default/7.keys");
        file("s3/default/current");
        file("acme/site/builds/42/index.html");

        List<Path> removed = LegacyOutputCleanup.run(root, NO_PROJECTS);

        assertThat(removed).containsExactlyInAnyOrder(root.resolve("builds"), root.resolve("current"), root.resolve("s3"));
        assertThat(root.resolve("builds")).doesNotExist();
        assertThat(root.resolve("current")).doesNotExist();
        assertThat(root.resolve("s3")).doesNotExist();
        assertThat(root.resolve("acme/site/builds/42/index.html")).exists();
    }

    @Test
    void keepsFoldersOwnedByProjectsWithLegacyLookingKeys() throws IOException {
        file("builds/target-3/builds/1/index.html");
        file("current/target-1/current");
        file("s3/site/current");
        Set<String> keys = Set.of("builds", "current", "s3");

        assertThat(LegacyOutputCleanup.run(root, keys::contains)).isEmpty();
        assertThat(root.resolve("builds/target-3/builds/1/index.html")).exists();
        assertThat(root.resolve("current/target-1/current")).exists();
        assertThat(root.resolve("s3/site/current")).exists();
    }

    @Test
    void keepsDirectoriesWithUnrecognizedContent() throws IOException {
        file("builds/42/index.html");
        file("builds/notes.txt");
        file("s3/default/7.keys");
        file("s3/default/readme.md");

        assertThat(LegacyOutputCleanup.run(root, NO_PROJECTS)).isEmpty();
        assertThat(root.resolve("builds/42/index.html")).exists();
        assertThat(root.resolve("s3/default/7.keys")).exists();
    }

    @Test
    void keepsCurrentWhenItIsADirectory() throws IOException {
        file("current/index.html");

        assertThat(LegacyOutputCleanup.run(root, NO_PROJECTS)).isEmpty();
        assertThat(root.resolve("current/index.html")).exists();
    }

    @Test
    void missingOrEmptyRootIsANoOp() {
        assertThat(LegacyOutputCleanup.run(root, NO_PROJECTS)).isEmpty();
        assertThat(LegacyOutputCleanup.run(root.resolve("missing"), NO_PROJECTS)).isEmpty();
    }

    private void file(String relative) throws IOException {
        Path path = root.resolve(relative);
        Files.createDirectories(path.getParent());
        Files.writeString(path, "x", StandardCharsets.UTF_8);
    }
}
