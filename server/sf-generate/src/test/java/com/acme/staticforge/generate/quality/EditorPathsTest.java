package com.acme.staticforge.generate.quality;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.Test;

/** Reference findings name the field that holds the reference (M30.2.1); carried outputs keep their events. */
class EditorPathsTest {

    private final ObjectMapper mapper = new ObjectMapper();

    @Test
    void findsTheFirstEditorPathOfEveryReferencedAssetInContentAndBodies() throws Exception {
        UUID team = UUID.randomUUID();
        UUID photo = UUID.randomUUID();
        UUID teaser = UUID.randomUUID();
        UUID pageTemplate = UUID.randomUUID();
        ObjectNode payload = (ObjectNode) mapper.readTree("""
                {"templateRef": "%s",
                 "content": {"cta": {"kind": "INTERNAL", "uuid": "%s"}, "links": [{"kind": "EXTERNAL", "url": "x"},
                   {"kind": "INTERNAL", "uuid": "%s"}]},
                 "bodies": {"main": [
                   {"instanceId": "i1", "templateRef": "%s", "content": {"image": {"type": "MEDIA_REF", "uuid": "%s"}}},
                   {"instanceId": "i2", "templateRef": "not-a-uuid", "content": {}}]}}
                """.formatted(pageTemplate, team, team, teaser, photo));

        Map<UUID, String> paths = EditorPaths.of(payload);

        assertThat(paths).containsExactlyInAnyOrderEntriesOf(Map.of(
                team, "content.cta",
                teaser, "bodies.main[0].templateRef",
                photo, "bodies.main[0].content.image"));
        assertThat(EditorPaths.of(null)).isEmpty();
        assertThat(EditorPaths.of(mapper.createArrayNode())).isEmpty();
    }

    @Test
    void theSidecarKeepsAnOutputsReferenceEventsAndReadsEntriesWithoutThem() {
        UUID team = UUID.randomUUID();
        ReferenceEvent event = new ReferenceEvent(ReferenceEvent.Kind.UNRELEASED, "page", team, "team", "de", "content.cta");
        QualitySidecar sidecar = new QualitySidecar(QualitySidecar.VERSION, "f", Map.of(
                "a.html", new QualitySidecar.Entry(null, List.of(), List.of(event)),
                "b.html", new QualitySidecar.Entry(null, List.of())));

        QualitySidecar read = QualitySidecar.parse(sidecar.toJson()).orElseThrow();

        assertThat(read.entry("a.html").orElseThrow().references()).containsExactly(event);
        assertThat(read.entry("b.html").orElseThrow().references()).isEmpty();
        assertThat(new String(sidecar.toJson())).as("no empty lists written").doesNotContain("\"references\":[]");
        assertThat(QualitySidecar.parse("{\"version\":1,\"outputs\":{\"c.html\":{\"findings\":[]}}}".getBytes())
                .orElseThrow().entry("c.html").orElseThrow().references()).isEmpty();
    }
}
