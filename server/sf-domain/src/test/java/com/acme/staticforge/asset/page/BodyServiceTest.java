package com.acme.staticforge.asset.page;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.junit.jupiter.api.Test;

class BodyServiceTest {

    private final BodyService bodyService = new BodyService(new ObjectMapper());

    @Test
    void extractSectionReturnsCopyAndInsertSectionAppendsAtPosition() {
        ObjectNode page = bodyService.addSection(null, "main", "tpl-1", null, "sec-1");
        page = bodyService.addSection(page, "main", "tpl-2", null, "sec-2");

        JsonNode extracted = bodyService.extractSection(page, "main", "sec-1");
        assertThat(extracted).isNotNull();
        assertThat(extracted.path("templateRef").asText()).isEqualTo("tpl-1");

        ObjectNode withoutSource = bodyService.removeSection(page, "main", "sec-1");
        ObjectNode moved = bodyService.insertSection(withoutSource, "sidebar", 0, extracted);

        assertThat(moved.at("/bodies/main")).hasSize(1);
        assertThat(moved.at("/bodies/main/0/instanceId").asText()).isEqualTo("sec-2");
        assertThat(moved.at("/bodies/sidebar")).hasSize(1);
        assertThat(moved.at("/bodies/sidebar/0/instanceId").asText()).isEqualTo("sec-1");
        assertThat(moved.at("/bodies/sidebar/0/templateRef").asText()).isEqualTo("tpl-1");
    }

    @Test
    void extractSectionReturnsNullWhenMissing() {
        ObjectNode page = bodyService.addSection(null, "main", "tpl-1", null, "sec-1");
        assertThat(bodyService.extractSection(page, "main", "does-not-exist")).isNull();
    }

    @Test
    void insertSectionClampsOutOfRangePositionToEnd() {
        ObjectNode page = bodyService.addSection(null, "main", "tpl-1", null, "sec-1");
        JsonNode section = bodyService.extractSection(page, "main", "sec-1");

        ObjectNode target = bodyService.insertSection(null, "main", 99, section);

        assertThat(target.at("/bodies/main")).hasSize(1);
        assertThat(target.at("/bodies/main/0/instanceId").asText()).isEqualTo("sec-1");
    }
}
