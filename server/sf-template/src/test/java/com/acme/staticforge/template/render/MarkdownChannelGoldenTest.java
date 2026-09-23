package com.acme.staticforge.template.render;

import static org.assertj.core.api.Assertions.assertThat;

import com.acme.staticforge.template.diagnostic.Diagnostic;
import com.acme.staticforge.template.diagnostic.Severity;
import com.acme.staticforge.template.octl.OctlCompiler;
import com.acme.staticforge.template.octl.OctlResult;
import com.acme.staticforge.template.octl.ReferenceResolver;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.stream.Stream;
import org.junit.jupiter.api.Test;

/**
 * Directory-driven golden-file render tests for the {@code markdown} channel (spec §25.4,
 * §16.7). Each subdirectory of {@code src/test/resources/render-md} holds {@code template.octl},
 * {@code content.json} (optional) and {@code expected.md}. Compilation targets {@code channel =
 * "markdown"} with {@link Escaping#MARKDOWN}, so markdown source is emitted as-is and the
 * {@code md}/{@code plain} filters' HTML output passes through unescaped. Mirrors
 * {@link GoldenFileRenderTest}, including its optional {@code records.json} dataset stub and {@code pagination.json}.
 */
class MarkdownChannelGoldenTest {

    private final ObjectMapper mapper = new ObjectMapper();
    private final OctlCompiler compiler = new OctlCompiler();
    private final Renderer renderer = new OctlRenderer();

    @Test
    void rendersMarkdownGoldenFileCorpus() throws Exception {
        Path root = Path.of("src/test/resources/render-md");
        assertThat(Files.isDirectory(root)).as("render-md corpus directory exists").isTrue();

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
            String expected = read(dir.resolve("expected.md"));

            Map<String, UUID> uuids = new HashMap<>();
            Map<UUID, JsonNode> assetValues = new HashMap<>();
            GoldenRecordFixture records = new GoldenRecordFixture(uuids, assetValues);
            if (Files.exists(dir.resolve("records.json"))) {
                records.load(mapper.readTree(read(dir.resolve("records.json"))));
            }
            ReferenceResolver references = records.references();

            OctlResult result = GoldenFileRenderTest.compile(compiler, dir, octl, "markdown", references);
            List<Diagnostic> errors = result.diagnostics().stream()
                    .filter(d -> d.severity() == Severity.ERROR)
                    .toList();
            assertThat(errors).as("compile errors in %s", dir.getFileName()).isEmpty();

            RenderContext.Builder builder = RenderContext.builder()
                    .pagination(Files.exists(dir.resolve("pagination.json"))
                            ? mapper.readTree(Files.readString(dir.resolve("pagination.json")))
                            : null)
                    .channel("markdown")
                    .escaping(Escaping.MARKDOWN)
                    .values(content);
            if (records.hasRecords()) {
                builder.assetValueResolver(records.assetValueResolver());
                builder.blockResolver(records.blockResolver(compiler, "markdown"));
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
