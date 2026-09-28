package com.acme.staticforge.generate.target;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.acme.staticforge.generate.pipeline.OutputFile;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.util.List;
import java.util.Set;
import java.util.function.Function;
import java.util.stream.Stream;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.MethodSource;

/** Build sidecars ({@code builds/{runId}.{name}.json}, M30.1.3) for every {@link TargetWriter}: written, read, pruned. */
class BuildSidecarWritersTest {

    @TempDir
    Path tempDir;

    static Stream<Function<Path, TargetWriter>> writers() {
        return Stream.of(
                root -> new FilesystemTargetWriter(root, 1),
                root -> new ZipTargetWriter(root, 1),
                S3TargetWriter::new);
    }

    private static byte[] bytes(String text) {
        return text.getBytes(StandardCharsets.UTF_8);
    }

    private static void publish(TargetWriter writer, long runId) {
        writer.stage(runId, List.of(new OutputFile("index.html", bytes("run " + runId))));
        writer.writeSidecar(runId, "quality", bytes("{\"run\":" + runId + "}"));
        writer.writeManifest(runId, new BuildManifest(BuildManifest.VERSION, runId, runId, runId, Set.of("html"), List.of()));
        writer.publish(runId);
    }

    @ParameterizedTest
    @MethodSource("writers")
    void aSidecarIsStoredWithItsBuildOutsideTheServedFiles(Function<Path, TargetWriter> factory) {
        TargetWriter writer = factory.apply(tempDir);
        publish(writer, 1);

        assertThat(writer.readSidecar(1, "quality")).hasValueSatisfying(
                read -> assertThat(new String(read, StandardCharsets.UTF_8)).isEqualTo("{\"run\":1}"));
        assertThat(writer.readSidecar(1, "other")).isEmpty();
        assertThat(writer.readSidecar(2, "quality")).as("no such build").isEmpty();
        assertThat(writer.readSidecar(-1, "quality")).isEmpty();
        assertThat(writer.readFile(1, "1.quality.json")).as("not a served file").isEmpty();
    }

    @ParameterizedTest
    @MethodSource("writers")
    void sidecarNamesAreSingleLowerCaseWords(Function<Path, TargetWriter> factory) {
        TargetWriter writer = factory.apply(tempDir);
        assertThatThrownBy(() -> writer.writeSidecar(1, "../x", bytes("x"))).isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> writer.writeSidecar(1, "manifest", bytes("x"))).isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> writer.writeSidecar(1, "Quality", bytes("x"))).isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    void theFilesystemWriterPrunesSidecarsWithTheirBuildsAndListsThem() {
        FilesystemTargetWriter writer = new FilesystemTargetWriter(tempDir, 1);
        for (long run = 1; run <= 3; run++) {
            publish(writer, run);
        }

        assertThat(tempDir.resolve("builds").resolve("1.quality.json")).doesNotExist();
        assertThat(writer.readSidecar(1, "quality")).isEmpty();
        assertThat(writer.readSidecar(2, "quality")).isPresent();
        assertThat(writer.readSidecar(3, "quality")).isPresent();
        assertThat(writer.storedItems())
                .filteredOn(item -> item.kind() == StoredItem.Kind.SIDECAR)
                .extracting(StoredItem::runId)
                .containsExactlyInAnyOrder(2L, 3L);
    }

    @Test
    void theZipWriterPrunesSidecarsWithTheirArchivesAndListsThem() {
        ZipTargetWriter writer = new ZipTargetWriter(tempDir, 1);
        for (long run = 1; run <= 3; run++) {
            publish(writer, run);
        }

        assertThat(tempDir.resolve("builds").resolve("1.quality.json")).doesNotExist();
        assertThat(writer.readSidecar(2, "quality")).isPresent();
        assertThat(writer.storedItems())
                .filteredOn(item -> item.kind() == StoredItem.Kind.SIDECAR)
                .extracting(StoredItem::runId)
                .containsExactlyInAnyOrder(2L, 3L);
    }

    @Test
    void theS3MirrorKeepsEverySidecarLikeEveryMirror() {
        S3TargetWriter writer = new S3TargetWriter(tempDir);
        for (long run = 1; run <= 3; run++) {
            publish(writer, run);
        }

        // The local S3 mirror keeps every published run (no keep-builds pruning, M29.2.2); so do its sidecars.
        assertThat(writer.readSidecar(1, "quality")).isPresent();
        assertThat(writer.readSidecar(3, "quality")).isPresent();
    }

    @Test
    void sidecarFileNamesAreRecognized() {
        assertThat(TargetIo.sidecarRunId("17.quality.json")).isEqualTo(17);
        assertThat(TargetIo.sidecarRunId("17.manifest.json")).isEqualTo(-1);
        assertThat(TargetIo.sidecarRunId("17.zip")).isEqualTo(-1);
        assertThat(TargetIo.sidecarRunId("x.quality.json")).isEqualTo(-1);
    }
}
