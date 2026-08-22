package com.acme.staticforge.generate.target;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.acme.staticforge.generate.pipeline.OutputFile;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

class FilesystemTargetWriterTest {

    @TempDir
    Path tempDir;

    @Test
    void stageAndPublishFlipsCurrentAndWritesFiles() {
        FilesystemTargetWriter writer = new FilesystemTargetWriter(tempDir, 3);

        List<OutputFile> files = List.of(
                new OutputFile("index.html", "<html>hi</html>".getBytes(StandardCharsets.UTF_8)),
                new OutputFile("assets/app.js", "console.log(1);".getBytes(StandardCharsets.UTF_8)));

        writer.stage(42L, files);
        assertThat(Files.isDirectory(tempDir.resolve("builds").resolve("42"))).isTrue();

        writer.publish(42L);
        assertThat(writer.currentRunId()).isEqualTo(42L);
        assertThat(tempDir.resolve("builds").resolve("42").resolve("index.html")).exists();
        assertThat(tempDir.resolve("builds").resolve("42").resolve("assets").resolve("app.js")).exists();
    }

    @Test
    void incompleteStageDoesNotCreateCurrent() {
        FilesystemTargetWriter writer = new FilesystemTargetWriter(tempDir, 3);
        writer.stage(7L, List.of(new OutputFile("index.html", "x".getBytes(StandardCharsets.UTF_8))));

        assertThat(writer.currentRunId()).isEqualTo(-1L);
        assertThatThrownBy(() -> writer.publish(999L)).isInstanceOf(IllegalStateException.class);
        assertThat(writer.currentRunId()).isEqualTo(-1L);
    }

    @Test
    void promoteFailsForMissingBuild() {
        FilesystemTargetWriter writer = new FilesystemTargetWriter(tempDir, 3);
        assertThatThrownBy(() -> writer.promote(123L)).isInstanceOf(IllegalStateException.class);
    }

    @Test
    void promoteRepointsCurrentAtPriorBuild() {
        FilesystemTargetWriter writer = new FilesystemTargetWriter(tempDir, 3);
        writer.stage(1L, List.of(new OutputFile("a.html", "a".getBytes(StandardCharsets.UTF_8))));
        writer.publish(1L);
        writer.stage(2L, List.of(new OutputFile("b.html", "b".getBytes(StandardCharsets.UTF_8))));
        writer.publish(2L);

        writer.promote(1L);
        assertThat(writer.currentRunId()).isEqualTo(1L);
    }
}
