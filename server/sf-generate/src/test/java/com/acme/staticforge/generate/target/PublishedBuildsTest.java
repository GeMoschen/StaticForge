package com.acme.staticforge.generate.target;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.acme.staticforge.generate.pipeline.OutputFile;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.attribute.FileTime;
import java.time.Instant;
import java.util.List;
import java.util.Set;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

/**
 * Published builds only (M29.2.2): {@code keep-builds} counts published builds, the retained-run listing names them
 * (and {@code current}), stored items are classified for {@code build-output-cleanup}, and deleting never follows links
 * or takes the current build.
 */
class PublishedBuildsTest {

    @TempDir
    Path tempDir;

    private static OutputFile file(String path, String text) {
        return new OutputFile(path, text.getBytes(StandardCharsets.UTF_8));
    }

    private static BuildManifest manifest(long run) {
        return new BuildManifest(BuildManifest.VERSION, run, run, run, Set.of("html"), List.of());
    }

    /** Stages, writes the manifest and publishes, as a successful run does. */
    private static void published(TargetWriter writer, long run) {
        writer.stage(run, List.of(file("index.html", "run " + run)));
        writer.writeManifest(run, manifest(run));
        writer.publish(run);
    }

    @Test
    void failedFilesystemRunsNoLongerPushPublishedBuildsOutOfKeepBuilds() {
        FilesystemTargetWriter writer = new FilesystemTargetWriter(tempDir, 3);
        published(writer, 1);
        published(writer, 2);
        published(writer, 3);
        // Five runs that staged and failed: no manifest, never published.
        for (long run = 4; run <= 8; run++) {
            writer.stage(run, List.of(file("index.html", "failed " + run)));
        }
        published(writer, 9);

        // current (9) plus the newest three published builds; the failed ones are not counted.
        assertThat(writer.retainedRunIds()).containsExactly(1L, 2L, 3L, 9L);
        assertThat(tempDir.resolve("builds/1")).isDirectory();
        published(writer, 10);
        assertThat(writer.retainedRunIds()).containsExactly(2L, 3L, 9L, 10L);
        assertThat(tempDir.resolve("builds/1")).doesNotExist();
        assertThat(tempDir.resolve("builds/1.manifest.json")).doesNotExist();
        // Unpublished builds are left for build-output-cleanup, never pruned.
        for (long run = 4; run <= 8; run++) {
            assertThat(tempDir.resolve("builds/" + run)).isDirectory();
        }
    }

    @Test
    void failedZipRunsNoLongerPushPublishedBuildsOutOfKeepBuilds() {
        ZipTargetWriter writer = new ZipTargetWriter(tempDir, 2);
        published(writer, 1);
        published(writer, 2);
        for (long run = 3; run <= 7; run++) {
            writer.stage(run, List.of(file("index.html", "failed " + run)));
        }
        published(writer, 8);

        assertThat(writer.retainedRunIds()).containsExactly(1L, 2L, 8L);
        assertThat(tempDir.resolve("builds/3.zip.tmp")).exists();
        assertThat(writer.storedItems())
                .filteredOn(item -> item.kind() == StoredItem.Kind.STAGED)
                .extracting(StoredItem::runId)
                .containsExactly(3L, 4L, 5L, 6L, 7L);
    }

    @Test
    void storedItemsOfAFilesystemTarget() throws IOException {
        FilesystemTargetWriter writer = new FilesystemTargetWriter(tempDir, 5);
        published(writer, 1);
        writer.stage(2, List.of(file("index.html", "failed")));
        writer.writeManifest(3, manifest(3));
        Path link = Files.writeString(tempDir.resolve(".current-123456.link"), "left behind");
        Files.setLastModifiedTime(link, FileTime.from(Instant.parse("2026-01-01T00:00:00Z")));

        List<StoredItem> items = writer.storedItems();

        assertThat(items).extracting(StoredItem::kind, StoredItem::runId).containsExactlyInAnyOrder(
                org.assertj.core.groups.Tuple.tuple(StoredItem.Kind.TEMP_LINK, -1L),
                org.assertj.core.groups.Tuple.tuple(StoredItem.Kind.BUILD, 1L),
                org.assertj.core.groups.Tuple.tuple(StoredItem.Kind.MANIFEST, 1L),
                org.assertj.core.groups.Tuple.tuple(StoredItem.Kind.BUILD, 2L),
                org.assertj.core.groups.Tuple.tuple(StoredItem.Kind.MANIFEST, 3L));
        assertThat(items).filteredOn(item -> item.kind() == StoredItem.Kind.TEMP_LINK).singleElement()
                .satisfies(item -> assertThat(item.modified()).isEqualTo(Instant.parse("2026-01-01T00:00:00Z")));
        // A staged build without a manifest is not retained.
        assertThat(writer.retainedRunIds()).containsExactly(1L);
        StoredItem failed = items.stream().filter(i -> i.runId() == 2 && i.kind() == StoredItem.Kind.BUILD).findFirst().orElseThrow();
        assertThat(writer.sizeOf(failed)).isEqualTo("failed".length());
        writer.delete(failed);
        assertThat(tempDir.resolve("builds/2")).doesNotExist();
    }

    @Test
    void theCurrentBuildAndPathsOutsideTheTargetAreNeverDeleted() throws IOException {
        FilesystemTargetWriter writer = new FilesystemTargetWriter(tempDir.resolve("site"), 5);
        published(writer, 1);
        StoredItem current = writer.storedItems().stream()
                .filter(item -> item.kind() == StoredItem.Kind.BUILD).findFirst().orElseThrow();

        assertThatThrownBy(() -> writer.delete(current)).isInstanceOf(IllegalArgumentException.class);
        Path outside = Files.createDirectories(tempDir.resolve("other/builds/7"));
        assertThatThrownBy(() -> writer.delete(new StoredItem(StoredItem.Kind.BUILD, 7, outside, Instant.EPOCH)))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> writer.delete(new StoredItem(
                StoredItem.Kind.BUILD, 7, tempDir.resolve("site/builds/../../other/builds/7"), Instant.EPOCH)))
                .isInstanceOf(IllegalArgumentException.class);
        assertThat(outside).isDirectory();
        assertThat(tempDir.resolve("site/builds/1/index.html")).exists();
    }

    @Test
    void deletingABuildLeavesTheHardLinkedFilesOfACarriedBuildIntact() throws IOException {
        FilesystemTargetWriter writer = new FilesystemTargetWriter(tempDir, 5);
        writer.stage(1, List.of(file("a.html", "shared"), file("b.html", "b1")));
        writer.writeManifest(1, manifest(1));
        writer.publish(1);
        writer.stage(2, 1, List.of(file("b.html", "b2")), Set.of());
        writer.writeManifest(2, manifest(2));
        writer.publish(2);

        StoredItem base = writer.storedItems().stream()
                .filter(item -> item.kind() == StoredItem.Kind.BUILD && item.runId() == 1).findFirst().orElseThrow();
        writer.delete(base);

        assertThat(tempDir.resolve("builds/1")).doesNotExist();
        assertThat(Files.readString(tempDir.resolve("builds/2/a.html"))).isEqualTo("shared");
        assertThat(Files.readString(tempDir.resolve("builds/2/b.html"))).isEqualTo("b2");
    }

    @Test
    void s3MirrorsAreRetainedButNotCleaned() {
        S3TargetWriter writer = new S3TargetWriter(tempDir);
        writer.stage(1, List.of(file("a.html", "a")));
        writer.publish(1);
        writer.stage(2, List.of(file("a.html", "never published")));

        assertThat(writer.retainedRunIds()).containsExactly(1L);
        assertThat(writer.storedItems()).isEmpty();
    }
}
