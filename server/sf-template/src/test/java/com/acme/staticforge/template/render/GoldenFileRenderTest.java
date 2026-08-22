package com.acme.staticforge.template.render;

import static org.assertj.core.api.Assertions.assertThat;

import com.acme.staticforge.template.diagnostic.Severity;
import com.acme.staticforge.template.octl.OctlCompiler;
import com.acme.staticforge.template.octl.OctlResult;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.stream.Stream;
import org.junit.jupiter.api.Test;

/**
 * Directory-driven golden-file render tests (spec §25.4). Each subdirectory of
 * {@code src/test/resources/render} holds {@code template.octl}, {@code content.json}
 * (optional) and {@code expected.html}; adding a language feature adds a directory with
 * no test-code change.
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

            OctlResult result = compiler.compile(octl, "html", null);
            List<com.acme.staticforge.template.diagnostic.Diagnostic> errors =
                    result.diagnostics().stream()
                            .filter(d -> d.severity() == Severity.ERROR)
                            .toList();
            assertThat(errors).as("compile errors in %s", dir.getFileName()).isEmpty();

            RenderContext context =
                    RenderContext.builder().channel("html").escaping(Escaping.HTML).values(content).build();
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
