package com.acme.staticforge.template.render;

import static org.assertj.core.api.Assertions.assertThat;

import com.acme.staticforge.template.diagnostic.Severity;
import com.acme.staticforge.template.octl.OctlCompiler;
import com.acme.staticforge.template.octl.OctlResult;
import com.acme.staticforge.template.octl.ReferenceResolver;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.MissingNode;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.stream.Stream;
import org.junit.jupiter.api.Test;

/**
 * Directory-driven golden-file render tests (spec §25.4). Each subdirectory of
 * {@code src/test/resources/render} holds {@code template.octl}, {@code content.json}
 * (optional) and {@code expected.html}; adding a language feature adds a directory with
 * no test-code change.
 *
 * <p>An optional {@code references.json} stubs cross-asset lookups: it maps each
 * {@code assetType:uid} reference key to {@code {uuid, value}}. The compiler resolves the key to
 * {@code uuid}, and the render context gets an {@link AssetValueResolver} returning {@code value}
 * for that UUID ({@code null} stands for a missing/deleted asset). Without the file, the case
 * compiles and renders with no resolvers at all.
 */
class GoldenFileRenderTest {

    private final ObjectMapper mapper = new ObjectMapper();
    private final OctlCompiler compiler = new OctlCompiler();
    private final Renderer renderer = new OctlRenderer();

    @Test
    void rendersGoldenFileCorpus() throws Exception {
        Path root = Path.of("src/test/resources/render");
        assertThat(Files.isDirectory(root)).as("render corpus directory exists").isTrue();

        List<Path> cases;
        try (Stream<Path> stream = Files.list(root)) {
            cases = stream.filter(Files::isDirectory).sorted().toList();
        }
        assertThat(cases).as("corpus is non-empty").isNotEmpty();

        for (Path dir : cases) {
            String octl = read(dir.resolve("template.octl"));
            JsonNode content = Files.exists(dir.resolve("content.json"))
                    ? mapper.readTree(read(dir.resolve("content.json")))
                    : mapper.createObjectNode();
            String expected = read(dir.resolve("expected.html"));

            Map<String, UUID> uuids = new HashMap<>();
            Map<UUID, JsonNode> assetValues = new HashMap<>();
            if (Files.exists(dir.resolve("references.json"))) {
                mapper.readTree(read(dir.resolve("references.json"))).fields().forEachRemaining(entry -> {
                    UUID uuid = UUID.fromString(entry.getValue().path("uuid").asText());
                    uuids.put(entry.getKey(), uuid);
                    JsonNode value = entry.getValue().path("value");
                    assetValues.put(uuid, value.isObject() ? value : MissingNode.getInstance());
                });
            }
            ReferenceResolver references = uuids.isEmpty()
                    ? null
                    : (assetType, uid) -> Optional.ofNullable(uuids.get(assetType + ":" + uid));

            OctlResult result = compiler.compile(octl, "html", references);
            List<com.acme.staticforge.template.diagnostic.Diagnostic> errors =
                    result.diagnostics().stream()
                            .filter(d -> d.severity() == Severity.ERROR)
                            .toList();
            assertThat(errors).as("compile errors in %s", dir.getFileName()).isEmpty();

            RenderContext.Builder builder = RenderContext.builder().channel("html").escaping(Escaping.HTML).values(content);
            if (!assetValues.isEmpty()) {
                builder.assetValueResolver((assetType, uuid) -> assetValues.getOrDefault(uuid, MissingNode.getInstance()));
            }
            RenderContext context = builder.build();
            String actual = renderer.render(result.template(), context).output();

            assertThat(normalize(actual))
                    .as("case %s\n--- actual ---\n%s\n--- expected ---\n%s", dir.getFileName(), actual, expected)
                    .isEqualTo(normalize(expected));
        }
    }

    private static String read(Path path) throws java.io.IOException {
        return Files.readString(path);
    }

    private static String normalize(String s) {
        String normalized = s.replace("\r\n", "\n");
        if (normalized.endsWith("\n")) {
            normalized = normalized.substring(0, normalized.length() - 1);
        }
        return normalized;
    }
}
