package com.acme.staticforge.generate.target;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.acme.staticforge.generate.pipeline.OutputFile;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.function.Function;
import java.util.stream.Stream;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.MethodSource;

/** Carrying a build forward and build manifests, for every {@link TargetWriter} (M22.4.1). */
class CarriedBuildWritersTest {

    @TempDir
    Path tempDir;

    static Stream<Function<Path, TargetWriter>> writers() {
        return Stream.of(
                root -> new FilesystemTargetWriter(root, 1),
                root -> new ZipTargetWriter(root, 1),
                S3TargetWriter::new);
    }

    private static OutputFile file(String path, String text) {
        return new OutputFile(path, text.getBytes(StandardCharsets.UTF_8));
    }

    private static String text(TargetWriter writer, long runId, String path) {
        return writer.readFile(runId, path).map(bytes -> new String(bytes, StandardCharsets.UTF_8)).orElse(null);
    }

    @ParameterizedTest
    @MethodSource("writers")
    void aCarriedBuildIsTheBaseMinusRemovedPlusOverlay(Function<Path, TargetWriter> factory) {
        TargetWriter writer = factory.apply(tempDir);
        writer.stage(1, List.of(file("a.html", "a1"), file("b.html", "b1"), file("dir/c.html", "c1")));
        writer.publish(1);

        writer.stage(2, 1, List.of(file("b.html", "b2"), file("d.html", "d2")), Set.of("dir/c.html"));
        writer.publish(2);

        assertThat(writer.currentRunId()).isEqualTo(2);
        assertThat(text(writer, 2, "a.html")).isEqualTo("a1");
        assertThat(text(writer, 2, "b.html")).isEqualTo("b2");
        assertThat(text(writer, 2, "d.html")).isEqualTo("d2");
        assertThat(writer.readFile(2, "dir/c.html")).isEmpty();
        // The base build is only read.
        assertThat(text(writer, 1, "b.html")).isEqualTo("b1");
        assertThat(text(writer, 1, "dir/c.html")).isEqualTo("c1");
    }

    @ParameterizedTest
    @MethodSource("writers")
    void aMissingBaseBuildFailsTheStage(Function<Path, TargetWriter> factory) {
        TargetWriter writer = factory.apply(tempDir);
        assertThatThrownBy(() -> writer.stage(2, 1, List.of(file("a.html", "a")), Set.of()))
                .isInstanceOf(IllegalStateException.class);
    }

    @ParameterizedTest
    @MethodSource("writers")
    void theManifestIsStoredWithTheBuild(Function<Path, TargetWriter> factory) {
        TargetWriter writer = factory.apply(tempDir);
        UUID page = UUID.randomUUID();
        BuildManifest manifest = new BuildManifest(BuildManifest.VERSION, 1, 10, 10, Set.of("html"), List.of(
                new BuildManifest.Output("a.html", BuildManifest.Kind.PAGE, page, "html", null, Set.of()),
                new BuildManifest.Output("sitemap.xml", BuildManifest.Kind.SITE, null, null, null, null)));
        writer.stage(1, List.of(file("a.html", "a")));
        writer.writeManifest(1, manifest);
        writer.publish(1);

        assertThat(writer.readManifest(1)).contains(manifest);
        assertThat(writer.readManifest(2)).isEmpty();
        assertThat(writer.readManifest(-1)).isEmpty();
    }

    @Test
    void prunedBuildsLoseTheirManifest() {
        FilesystemTargetWriter writer = new FilesystemTargetWriter(tempDir, 1);
        for (long run = 1; run <= 3; run++) {
            writer.stage(run, List.of(file("a.html", "a" + run)));
            writer.writeManifest(run, new BuildManifest(BuildManifest.VERSION, run, run, run, Set.of("html"), List.of()));
            writer.publish(run);
        }
        assertThat(writer.readManifest(1)).isEmpty();
        assertThat(tempDir.resolve("builds").resolve("1.manifest.json")).doesNotExist();
        assertThat(writer.readManifest(2)).isPresent();
        assertThat(writer.readManifest(3)).isPresent();
    }

    @Test
    void aCarriedS3MirrorHasACompleteKeyManifestAndOnlyChangedKeysToInvalidate() {
        S3TargetWriter writer = new S3TargetWriter(tempDir);
        writer.stage(1, List.of(file("a.html", "a1"), file("b.html", "b1")));
        writer.publish(1);

        writer.stage(2, 1, List.of(file("b.html", "b2")), Set.of());
        writer.publish(2);

        assertThat(writer.keys(2)).containsOnlyKeys("a.html", "b.html");
        assertThat(writer.keys(2).get("a.html")).isEqualTo(writer.keys(1).get("a.html"));
        assertThat(writer.changedKeys(2)).containsExactly("b.html");
    }

    @Test
    void aManifestOfAnotherVersionOrUnreadableIsIgnored() {
        assertThat(BuildManifest.parse("{\"version\":99,\"outputs\":[]}".getBytes(StandardCharsets.UTF_8))).isEmpty();
        assertThat(BuildManifest.parse("not json".getBytes(StandardCharsets.UTF_8))).isEmpty();
        assertThat(BuildManifest.parse(("{\"version\":1,\"runId\":1,\"revision\":2,\"consistentRevision\":2,"
                + "\"completeChannels\":[\"html\"],\"outputs\":[],\"addedLater\":true}").getBytes(StandardCharsets.UTF_8)))
                .map(BuildManifest::completeChannels)
                .contains(Set.of("html"));
        assertThat(new BuildManifest(1, 1, 1, 1, Set.of("html", "md"), List.of()).completeFor(Set.of("html"))).isTrue();
        assertThat(new BuildManifest(1, 1, 1, 1, Set.of("html"), List.of()).completeFor(Set.of("html", "md"))).isFalse();
        assertThat(new BuildManifest(1, 1, 1, 1, Set.of(), List.of()).completeFor(Set.of())).isFalse();
    }
}
