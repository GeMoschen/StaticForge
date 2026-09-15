package com.acme.staticforge.generate;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.lang.reflect.Field;
import java.nio.file.Path;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

class TargetLocationsTest {

    private static final ObjectMapper MAPPER = new ObjectMapper();

    @TempDir
    Path outputRoot;

    @Test
    void missingOrBlankPathFallsBackToTargetId() throws Exception {
        assertThat(TargetLocations.relativePath(target(7L, null))).isEqualTo("target-7");
        assertThat(TargetLocations.relativePath(target(7L, config("  ")))).isEqualTo("target-7");
        assertThat(TargetLocations.relativePath(target(7L, MAPPER.readTree("{\"baseUrl\":\"x\"}"))))
                .isEqualTo("target-7");
    }

    @Test
    void configuredPathIsNormalized() {
        assertThat(TargetLocations.relativePath(target(1L, config("site/live/")))).isEqualTo("site/live");
        assertThat(TargetLocations.relativePath(target(1L, config("site\\staging")))).isEqualTo("site/staging");
    }

    @ParameterizedTest
    @ValueSource(strings = {"/abs", "../escape", "a/../b", "a//b", "./a", "with space", "c:/win", "target-3", "target-3/x"})
    void invalidPathsAreRejected(String path) {
        assertThatThrownBy(() -> TargetLocations.configuredPath(config(path)))
                .isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    void nonTextualPathIsRejected() throws Exception {
        assertThatThrownBy(() -> TargetLocations.configuredPath(MAPPER.readTree("{\"path\":5}")))
                .isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    void resolvesUnderProjectFolder() {
        Path dir = TargetLocations.resolve(outputRoot, "acme", target(1L, config("site")));
        assertThat(dir).isEqualTo(outputRoot.toAbsolutePath().normalize().resolve("acme").resolve("site"));
        assertThat(TargetLocations.outputPath("acme", target(9L, null))).isEqualTo("acme/target-9");
    }

    @Test
    void differentProjectsGetDifferentDirectoriesForTheSamePath() {
        GenerationTarget a = target(1L, config("site"));
        GenerationTarget b = target(2L, config("site"));
        assertThat(TargetLocations.resolve(outputRoot, "alpha", a))
                .isNotEqualTo(TargetLocations.resolve(outputRoot, "beta", b));
    }

    @Test
    void overlapDetectsEqualAndNestedPathsCaseInsensitively() {
        assertThat(TargetLocations.overlaps("site", "site")).isTrue();
        assertThat(TargetLocations.overlaps("site", "Site")).isTrue();
        assertThat(TargetLocations.overlaps("site", "site/builds")).isTrue();
        assertThat(TargetLocations.overlaps("site/builds", "site")).isTrue();
        assertThat(TargetLocations.overlaps("site", "site-2")).isFalse();
        assertThat(TargetLocations.overlaps("site", "staging")).isFalse();
    }

    private static JsonNode config(String path) {
        ObjectNode node = MAPPER.createObjectNode();
        node.put("path", path);
        return node;
    }

    private static GenerationTarget target(long id, JsonNode config) {
        GenerationTarget target = new GenerationTarget(1L, "t", TargetType.FILESYSTEM, config, false);
        try {
            Field field = GenerationTarget.class.getDeclaredField("id");
            field.setAccessible(true);
            field.set(target, id);
        } catch (ReflectiveOperationException e) {
            throw new IllegalStateException(e);
        }
        return target;
    }
}
