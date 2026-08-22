package com.acme.staticforge.exportimport;

import static org.assertj.core.api.Assertions.assertThat;

import com.acme.staticforge.common.JsonUtil;
import com.fasterxml.jackson.databind.JsonNode;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.Test;

/** Pure-logic tests for import UUID generation and payload reference remapping (spec §6.1). */
class ExportImportLogicTest {

    @Test
    void uuidsAreVersion7VariantIetf() {
        for (int i = 0; i < 1_000; i++) {
            UUID uuid = UuidV7.generate();
            assertThat(uuid.version()).isEqualTo(7);
            assertThat(uuid.variant()).isEqualTo(2);
        }
    }

    @Test
    void uuidsAreUnique() {
        java.util.Set<UUID> seen = new java.util.HashSet<>();
        for (int i = 0; i < 1_000; i++) {
            seen.add(UuidV7.generate());
        }
        assertThat(seen).hasSize(1_000);
    }

    @Test
    void remapRewritesKnownUuidStringValues() {
        UUID oldTemplate = UUID.randomUUID();
        UUID newTemplate = UuidV7.generate();
        UUID oldMedia = UUID.randomUUID();
        UUID newMedia = UuidV7.generate();

        Map<String, UUID> remap = Map.of(
                oldTemplate.toString(), newTemplate,
                oldMedia.toString(), newMedia);

        JsonNode payload = JsonUtil.parse("""
                {
                  "templateRef": "%s",
                  "content": { "hero": { "type": "MEDIA_REF", "uuid": "%s" } },
                  "bodies": { "main": [ { "instanceId": "0190a1b2-0000-7000-8000-000000000000", "templateRef": "%s" } ] }
                }
                """.formatted(oldTemplate, oldMedia, oldTemplate));

        JsonNode remapped = UuidRemapper.remap(payload, remap);

        assertThat(remapped.path("templateRef").asText()).isEqualTo(newTemplate.toString());
        assertThat(remapped.path("content").path("hero").path("uuid").asText()).isEqualTo(newMedia.toString());
        assertThat(remapped.path("bodies").path("main").get(0).path("templateRef").asText())
                .isEqualTo(newTemplate.toString());
        assertThat(remapped.path("bodies").path("main").get(0).path("instanceId").asText())
                .isEqualTo("0190a1b2-0000-7000-8000-000000000000");
    }

    @Test
    void remapLeavesUnknownValuesUntouched() {
        Map<String, UUID> remap = Map.of(UUID.randomUUID().toString(), UuidV7.generate());

        JsonNode payload = JsonUtil.parse("{\"title\": \"Hello\", \"count\": 5, \"flag\": true}");

        JsonNode remapped = UuidRemapper.remap(payload, remap);

        assertThat(remapped).isEqualTo(JsonUtil.parse("{\"title\": \"Hello\", \"count\": 5, \"flag\": true}"));
    }
}
