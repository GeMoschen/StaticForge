package com.acme.staticforge.generate.target;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Set;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

/** Output directories of deleted targets (M29.2.2): ownership by {@code target-{id}} and {@code config.path}. */
class OrphanedTargetDirectoriesTest {

    @TempDir
    Path root;

    private Path target(String relative) throws IOException {
        Path dir = Files.createDirectories(root.resolve("acme").resolve(relative).resolve("builds/1"));
        Files.writeString(dir.getParent().getParent().resolve("current"), "1");
        return dir.getParent().getParent();
    }

    @Test
    void directoriesNoTargetOwnsAreOrphanedOthersAreKept() throws IOException {
        target("target-1");
        Path deletedDefault = target("target-2");
        target("site/en");
        Path deletedNested = target("site/de");
        Path deletedCustom = target("docs");
        Path unrelated = Files.createDirectories(root.resolve("acme/notes"));
        Instant future = Instant.now().plus(Duration.ofMinutes(1));

        List<Path> orphans = OrphanedTargetDirectories.find(root, "acme", Set.of("target-1", "Site/EN"), future);

        assertThat(orphans).containsExactlyInAnyOrder(deletedDefault, deletedNested, deletedCustom);
        assertThat(orphans).doesNotContain(unrelated);
        assertThat(OrphanedTargetDirectories.sizeOf(deletedCustom)).isEqualTo(1);

        OrphanedTargetDirectories.delete(root, "acme", deletedCustom);
        assertThat(deletedCustom).doesNotExist();
        assertThat(root.resolve("acme/target-1/current")).exists();
    }

    @Test
    void recentDirectoriesAndPathsOutsideTheProjectAreLeftAlone() throws IOException {
        target("target-9");
        assertThat(OrphanedTargetDirectories.find(root, "acme", Set.of(), Instant.now().minus(Duration.ofHours(1)))).isEmpty();
        assertThat(OrphanedTargetDirectories.find(root, "missing", Set.of(), Instant.now())).isEmpty();

        Path other = Files.createDirectories(root.resolve("other/target-1"));
        assertThatThrownBy(() -> OrphanedTargetDirectories.delete(root, "acme", other))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> OrphanedTargetDirectories.delete(root, "acme", root.resolve("acme")))
                .isInstanceOf(IllegalArgumentException.class);
        assertThat(other).isDirectory();
    }
}
