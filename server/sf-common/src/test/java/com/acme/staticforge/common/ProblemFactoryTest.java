package com.acme.staticforge.common;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;

class ProblemFactoryTest {

    private final ObjectMapper mapper = new ObjectMapper();

    @Test
    void producesCanonicalProblemValues() {
        Problem problem = ProblemFactory.notFound("Asset 018f… not found");

        assertThat(problem.getStatus()).isEqualTo(404);
        assertThat(problem.getTitle()).isEqualTo("Not Found");
        assertThat(problem.getExtensions()).containsEntry("code", "SF-API-0404");
    }

    @Test
    void serializesExtensionsAsProblemMembers() throws Exception {
        Problem problem = ProblemFactory.unprocessableEntity("Required editor missing");

        String json = mapper.writeValueAsString(problem);

        assertThat(json).contains("\"code\":\"SF-API-0422\"");
        assertThat(json).contains("\"status\":422");
    }

    @Test
    void jsonUtilParsesAndReadsFields() {
        var node = JsonUtil.parse("{\"title\":\"Home\",\"nested\":{\"a\":1}}");

        assertThat(JsonUtil.text(node, "title")).contains("Home");
        assertThat(JsonUtil.isBlank(node.get("missing"))).isTrue();
    }
}
