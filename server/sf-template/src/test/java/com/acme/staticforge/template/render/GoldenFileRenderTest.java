package com.acme.staticforge.template.render;

import static org.assertj.core.api.Assertions.assertThat;

import com.acme.staticforge.template.diagnostic.Severity;
import com.acme.staticforge.template.octl.OctlCompiler;
import com.acme.staticforge.template.octl.OctlResult;
import com.acme.staticforge.template.octl.ReferenceResolver;
import com.acme.staticforge.template.query.RecordView;
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
 *
 * <p>An optional {@code records.json} stubs datasets (M19.3.2): it maps a dataset uid to
 * {@code {uuid, records: [{uuid, uid, displayName, folderPath, changedAt, content}]}}. Each dataset
 * resolves as {@code dataset:<uid>} and lists its records to loops; each record resolves as
 * {@code record:<uid>} and reads as its loop item, also when reached by dereferencing a reference.
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
            Map<UUID, List<RecordView>> datasets = new HashMap<>();
            if (Files.exists(dir.resolve("records.json"))) {
                loadRecords(mapper.readTree(read(dir.resolve("records.json"))), uuids, assetValues, datasets);
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
                builder.assetValueResolver(new AssetValueResolver() {
                    @Override
                    public JsonNode valueOf(String assetType, UUID uuid) {
                        return assetValues.getOrDefault(uuid, MissingNode.getInstance());
                    }

                    @Override
                    public List<RecordView> datasetRecords(UUID datasetUuid) {
                        return datasets.getOrDefault(datasetUuid, List.of());
                    }
                });
            }
            RenderContext context = builder.build();
            String actual = renderer.render(result.template(), context).output();

            assertThat(normalize(actual))
                    .as("case %s\n--- actual ---\n%s\n--- expected ---\n%s", dir.getFileName(), actual, expected)
                    .isEqualTo(normalize(expected));
        }
    }

    /** Registers each dataset and record of a {@code records.json} fixture with the stub resolvers. */
    static void loadRecords(
            JsonNode fixture, Map<String, UUID> uuids, Map<UUID, JsonNode> assetValues, Map<UUID, List<RecordView>> datasets) {
        fixture.fields().forEachRemaining(dataset -> {
            UUID datasetUuid = UUID.fromString(dataset.getValue().path("uuid").asText());
            uuids.put("dataset:" + dataset.getKey(), datasetUuid);
            List<RecordView> records = new java.util.ArrayList<>();
            for (JsonNode record : dataset.getValue().path("records")) {
                RecordView view = new RecordView(
                        UUID.fromString(record.path("uuid").asText()),
                        record.path("uid").asText(),
                        record.path("displayName").asText(),
                        record.path("folderPath").asText("/"),
                        java.time.Instant.parse(record.path("changedAt").asText("2026-01-01T00:00:00Z")),
                        record.path("content"));
                records.add(view);
                uuids.put("record:" + view.uid(), view.uuid());
                assetValues.put(view.uuid(), view.item());
            }
            datasets.put(datasetUuid, records);
        });
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
