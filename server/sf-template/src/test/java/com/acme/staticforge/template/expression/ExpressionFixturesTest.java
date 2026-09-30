package com.acme.staticforge.template.expression;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.stream.Stream;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.Arguments;
import org.junit.jupiter.params.provider.MethodSource;

/**
 * The {@code visibleWhen} fixtures shared with the Angular form engine ({@code ui/src/app/features/forms/
 * expression.fixtures.json}): the backend evaluator must agree with the UI on every entry (spec §14.4; before M33 only
 * the UI test read the file).
 */
class ExpressionFixturesTest {

    private static final ObjectMapper MAPPER = new ObjectMapper();

    static Stream<Arguments> fixtures() throws IOException {
        JsonNode entries = MAPPER.readTree(Files.readString(fixtureFile()));
        List<Arguments> out = new ArrayList<>();
        for (JsonNode entry : entries) {
            out.add(Arguments.of(entry.get("expression").asText(), entry.get("scope"), entry.get("result").asBoolean()));
        }
        return out.stream();
    }

    @ParameterizedTest(name = "{0} with {1} → {2}")
    @MethodSource("fixtures")
    void backendAgreesWithTheSharedFixtures(String expression, JsonNode scope, boolean expected) {
        assertThat(new ExpressionEvaluator().evaluate(expression, scope)).isEqualTo(expected);
    }

    /** The fixture file, found by walking up from the working directory to the repository root. */
    private static Path fixtureFile() {
        Path dir = Path.of("").toAbsolutePath();
        while (dir != null) {
            Path candidate = dir.resolve("ui/src/app/features/forms/expression.fixtures.json");
            if (Files.isRegularFile(candidate)) {
                return candidate;
            }
            dir = dir.getParent();
        }
        throw new IllegalStateException("expression.fixtures.json not found above " + Path.of("").toAbsolutePath());
    }
}
