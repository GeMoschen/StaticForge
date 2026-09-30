package com.acme.staticforge.template.expression;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneId;
import java.util.Map;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;

/** The rule expression language (M33.1): operators, functions, context, errors, limits and the v1 grammar. */
class ExpressionV2Test {

    private static final ObjectMapper MAPPER = new ObjectMapper();

    /** 2026-09-29T23:30:00Z: still the 29th in UTC, already the 30th in Berlin. */
    private static final Instant NOW = Instant.parse("2026-09-29T23:30:00Z");

    private static JsonNode json(String raw) {
        try {
            return MAPPER.readTree(raw);
        } catch (Exception e) {
            throw new AssertionError(e);
        }
    }

    private static JsonNode eval(String expression, String scope) {
        return eval(expression, scope, ExpressionHost.NONE);
    }

    private static JsonNode eval(String expression, String scope, ExpressionHost host) {
        return ExpressionCompiler.compile(expression)
                .evaluate(ExpressionScope.of(json(scope)), host, EvaluationBudget.standard());
    }

    private static String text(String expression, String scope) {
        return ExpressionValues.text(eval(expression, scope));
    }

    private static boolean test(String expression, String scope) {
        return ExpressionCompiler.compile(expression)
                .test(ExpressionScope.of(json(scope)), ExpressionHost.NONE, EvaluationBudget.standard());
    }

    private static ExpressionHost clockAt(String zone) {
        return new ExpressionHost() {
            @Override
            public Clock clock() {
                return Clock.fixed(NOW, ZoneId.of(zone));
            }
        };
    }

    @Nested
    class Operators {

        @Test
        void arithmeticIsDecimalWithoutFloatDrift() {
            assertThat(test("0.1 + 0.2 == 0.3", "{}")).isTrue();
            assertThat(text("price * 3", "{\"price\":19.99}")).isEqualTo("59.97");
            assertThat(text("10 / 4", "{}")).isEqualTo("2.5");
            assertThat(text("10 / 3", "{}")).isEqualTo("3.333333333333333");
            assertThat(text("10 % 4", "{}")).isEqualTo("2");
            assertThat(text("-(2 - 5)", "{}")).isEqualTo("3");
            assertThat(eval("2 + 3 * 4", "{}").intValue()).isEqualTo(14);
            assertThat(eval("(2 + 3) * 4", "{}").intValue()).isEqualTo(20);
        }

        @Test
        void plusConcatenatesWhenEitherSideIsText() {
            assertThat(text("'Page ' + n", "{\"n\":2}")).isEqualTo("Page 2");
            assertThat(text("title + ''", "{\"title\":\"x\"}")).isEqualTo("x");
            assertThat(text("'a' + missing", "{}")).isEqualTo("a");
        }

        @Test
        void arithmeticWithNullIsNull() {
            assertThat(eval("missing + 1", "{}").isNull()).isTrue();
            assertThat(eval("missing * 2 ?? 7", "{}").intValue()).isEqualTo(7);
        }

        @Test
        void comparisonsAndLogic() {
            assertThat(test("count >= 3 and count < 5", "{\"count\":3}")).isTrue();
            assertThat(test("count > 3 or flag", "{\"count\":3,\"flag\":true}")).isTrue();
            assertThat(test("!flag && not other", "{\"flag\":false,\"other\":false}")).isTrue();
            assertThat(test("'b' > 'a'", "{}")).isTrue();
            assertThat(test("1 == 1.0", "{}")).isTrue();
            assertThat(test("[1, 2] == [1, 2]", "{}")).isTrue();
        }

        @Test
        void comparingWithNullIsFalseAndMismatchedTypesAreErrors() {
            assertThat(test("missing < 3", "{}")).isFalse();
            assertThat(test("missing == null", "{}")).isTrue();
            assertThatThrownBy(() -> test("'a' < 3", "{}"))
                    .isInstanceOf(ExpressionError.class)
                    .hasMessageContaining("Can't compare text with a number");
        }

        @Test
        void inChecksListsTextAndObjectKeys() {
            assertThat(test("type in ['news', 'blog']", "{\"type\":\"news\"}")).isTrue();
            assertThat(test("'ell' in title", "{\"title\":\"Hello\"}")).isTrue();
            assertThat(test("'de' in values", "{\"values\":{\"de\":\"x\"}}")).isTrue();
            assertThat(test("'x' in missing", "{}")).isFalse();
        }

        @Test
        void ternaryAndCoalesce() {
            assertThat(text("n > 1 ? 'many' : 'one'", "{\"n\":2}")).isEqualTo("many");
            assertThat(text("n > 1 ? 'many' : n == 1 ? 'one' : 'none'", "{\"n\":0}")).isEqualTo("none");
            assertThat(text("subtitle ?? title", "{\"title\":\"T\"}")).isEqualTo("T");
            assertThat(text("subtitle ?? title", "{\"title\":\"T\",\"subtitle\":\"S\"}")).isEqualTo("S");
        }

        @Test
        void memberAndIndexAccess() {
            String scope = "{\"items\":[{\"caption\":\"a\"},{\"caption\":\"b\"}],\"map\":{\"k\":1}}";
            assertThat(text("items[1].caption", scope)).isEqualTo("b");
            assertThat(text("items[-1].caption", scope)).isEqualTo("b");
            assertThat(eval("items[5].caption", scope).isNull()).isTrue();
            assertThat(eval("map['k']", scope).intValue()).isEqualTo(1);
            assertThat(eval("missing.deep.path", scope).isNull()).isTrue();
        }

        @Test
        void globalReferencesReadTheScopesPropertySets() {
            ExpressionScope scope = new ExpressionScope() {
                @Override
                public JsonNode root(String name) {
                    return null;
                }

                @Override
                public JsonNode global(String setUid) {
                    return "site".equals(setUid) ? json("{\"title\":\"Acme\"}") : null;
                }
            };
            CompiledExpression expr = ExpressionCompiler.compile("global:site.title + '!'");
            assertThat(expr.evaluate(scope).asText()).isEqualTo("Acme!");
            assertThat(expr.identifiers()).containsExactly("global:site.title");
        }
    }

    @Nested
    class Functions {

        @Test
        void textFunctions() {
            assertThat(eval("length(title)", "{\"title\":\"Größe 🙂\"}").intValue()).isEqualTo(7);
            assertThat(eval("length(missing)", "{}").intValue()).isZero();
            assertThat(eval("length(items)", "{\"items\":[1,2,3]}").intValue()).isEqualTo(3);
            assertThat(text("lower('ÄBC')", "{}")).isEqualTo("äbc");
            assertThat(text("upper('abc')", "{}")).isEqualTo("ABC");
            assertThat(text("trim('  x  ')", "{}")).isEqualTo("x");
            assertThat(text("substring('abcdef', 1, 3)", "{}")).isEqualTo("bc");
            assertThat(text("substring('abc', 1)", "{}")).isEqualTo("bc");
            assertThat(text("substring('abc', 5)", "{}")).isEmpty();
            assertThat(text("concat('a', 1, missing, true)", "{}")).isEqualTo("a1true");
            assertThat(text("stripTags('<p>Hello <b>world</b> &amp; you</p>')", "{}")).isEqualTo("Hello world & you");
            assertThat(eval("wordCount(body)", "{\"body\":{\"value\":\"<p>one two  three</p>\"}}").intValue()).isEqualTo(3);
            assertThat(eval("wordCount('')", "{}").intValue()).isZero();
        }

        @Test
        void slugifyTransliteratesUmlautsAndUnicode() {
            assertThat(text("slugify(title)", "{\"title\":\"Über uns – Straße & Café!\"}")).isEqualTo("uber-uns-strasse-cafe");
            assertThat(text("slugify('  Ærø  Łódź ')", "{}")).isEqualTo("aero-lodz");
            assertThat(text("slugify('---')", "{}")).isEmpty();
        }

        @Test
        void emptiness() {
            assertThat(test("isEmpty(missing)", "{}")).isTrue();
            assertThat(test("isEmpty(t)", "{\"t\":\"  \"}")).isTrue();
            assertThat(test("isEmpty(l)", "{\"l\":[]}")).isTrue();
            assertThat(test("isEmpty(m)", "{\"m\":{\"type\":\"MEDIA_REF\",\"uuid\":null}}")).isTrue();
            assertThat(test("isEmpty(m)", "{\"m\":{\"type\":\"MEDIA_REF\",\"uuid\":\"u\"}}")).isFalse();
            assertThat(test("isEmpty(r)", "{\"r\":{\"value\":\"\"}}")).isTrue();
            assertThat(test("isEmpty(n)", "{\"n\":0}")).isFalse();
        }

        @Test
        void listFunctions() {
            String scope = "{\"items\":[{\"p\":2},{\"p\":5},{\"p\":null}],\"nums\":[3,1,2]}";
            assertThat(eval("count(items)", scope).intValue()).isEqualTo(3);
            assertThat(eval("count(missing)", scope).intValue()).isZero();
            assertThat(eval("sum(nums)", scope).intValue()).isEqualTo(6);
            assertThat(eval("sum(1, 2.5)", scope).decimalValue()).isEqualByComparingTo("3.5");
            assertThat(eval("min(nums)", scope).intValue()).isEqualTo(1);
            assertThat(eval("max(4, 9, missing)", scope).intValue()).isEqualTo(9);
            assertThat(test("any(items, it.p > 4)", scope)).isTrue();
            assertThat(test("all(items, it.p > 1)", scope)).isFalse();
            assertThat(test("all(missing, it > 1)", scope)).isTrue();
            assertThatThrownBy(() -> eval("count('text')", scope))
                    .isInstanceOf(ExpressionError.class)
                    .hasMessageContaining("count needs a list, got text");
        }

        @Test
        void sectionsFiltersABodyByTemplate() {
            String scope = "{\"body\":{\"main\":[{\"template\":\"hero\",\"content\":{}},"
                    + "{\"template\":\"text\",\"content\":{}},{\"template\":\"hero\",\"content\":{}}]}}";
            assertThat(eval("count(sections(body.main, 'hero'))", scope).intValue()).isEqualTo(2);
            assertThat(eval("count(sections(body.main))", scope).intValue()).isEqualTo(3);
            assertThat(eval("count(sections(body.aside, 'hero'))", scope).intValue()).isZero();
        }

        @Test
        void matchesUsesARegexAndStopsCatastrophicBacktracking() {
            assertThat(test("matches(code, '^[A-Z]{3}-\\\\d+$')", "{\"code\":\"ABC-12\"}")).isTrue();
            assertThat(test("matches(code, '^[A-Z]{3}$')", "{\"code\":\"ABC-12\"}")).isFalse();
            String evil = "{\"s\":\"" + "a".repeat(40) + "!\"}";
            long start = System.nanoTime();
            // The JDK defuses (a+)+$ with memoization; a bounded repeat of '.*a' still backtracks polynomially (n^12).
            assertThatThrownBy(() -> test("matches(s, '^(.*a){12}$')", evil))
                    .isInstanceOf(ExpressionError.class)
                    .hasMessageContaining("too complex");
            assertThat(Duration.ofNanos(System.nanoTime() - start)).isLessThan(Duration.ofSeconds(2));
            assertThatThrownBy(() -> test("matches('x', '(')", "{}"))
                    .isInstanceOf(ExpressionError.class)
                    .hasMessageContaining("Invalid regular expression");
        }

        @Test
        void refDelegatesToTheHost() {
            ExpressionHost host = new ExpressionHost() {
                @Override
                public JsonNode ref(JsonNode value) {
                    return value.path("uuid").asText().equals("m1") ? json("{\"meta\":{\"alt\":\"A dog\"}}") : null;
                }
            };
            String scope = "{\"image\":{\"type\":\"MEDIA_REF\",\"uuid\":\"m1\"},\"other\":{\"type\":\"MEDIA_REF\",\"uuid\":\"x\"}}";
            assertThat(eval("ref(image).meta.alt", scope, host).asText()).isEqualTo("A dog");
            assertThat(eval("ref(other).meta.alt", scope, host).isNull()).isTrue();
            assertThat(eval("ref(missing)", scope, host).isNull()).isTrue();
            assertThat(eval("ref(image)", scope).isNull()).as("no host resolves nothing").isTrue();
        }
    }

    @Nested
    class Dates {

        @Test
        void todayAndNowReadTheInjectedClockInItsZone() {
            ExpressionHost utc = clockAt("UTC");
            ExpressionHost berlin = clockAt("Europe/Berlin");
            assertThat(ExpressionValues.text(eval("today()", "{}", utc))).isEqualTo("2026-09-29");
            assertThat(ExpressionValues.text(eval("today()", "{}", berlin))).isEqualTo("2026-09-30");
            assertThat(ExpressionValues.toJson(eval("now()", "{}", utc)).asText()).isEqualTo("2026-09-29T23:30Z");
        }

        @Test
        void comparisonsAcrossTimeZonesUseTheInstant() {
            assertThat(test("date('2026-09-30T01:00:00+02:00') == date('2026-09-29T23:00:00Z')", "{}")).isTrue();
            assertThat(test("date('2026-09-30T01:00:00+02:00') < date('2026-09-29T23:30:00Z')", "{}")).isTrue();
            assertThat(test("date(d) > '2026-01-01'", "{\"d\":\"2026-09-29\"}")).isTrue();
            assertThat(test("date(d) == '2026-09-29'", "{\"d\":\"2026-09-29\"}")).isTrue();
        }

        @Test
        void daysBetweenCountsCalendarDaysInTheClocksZone() {
            ExpressionHost berlin = clockAt("Europe/Berlin");
            assertThat(eval("daysBetween('2026-09-01', '2026-09-29')", "{}").intValue()).isEqualTo(28);
            assertThat(eval("daysBetween(today(), '2026-10-01')", "{}", berlin).intValue()).isEqualTo(1);
            assertThat(eval("daysBetween('2026-09-29T23:30:00Z', '2026-09-30')", "{}", berlin).intValue())
                    .as("23:30 UTC is already the 30th in Berlin")
                    .isZero();
            assertThat(eval("daysBetween(missing, today())", "{}").isNull()).isTrue();
            assertThatThrownBy(() -> eval("date('not a date')", "{}"))
                    .isInstanceOf(ExpressionError.class)
                    .hasMessageContaining("Not a date");
        }
    }

    @Nested
    class CompileTimeChecks {

        @Test
        void unknownFunctionsAndWrongArityAreErrorsWithPositions() {
            assertThatThrownBy(() -> ExpressionCompiler.compile("1 + nope(title)"))
                    .isInstanceOf(ExpressionError.class)
                    .hasMessageContaining("Unknown function 'nope'")
                    .extracting(e -> ((ExpressionError) e).position())
                    .isEqualTo(4);
            assertThatThrownBy(() -> ExpressionCompiler.compile("length(a, b)"))
                    .hasMessageContaining("length takes 1 argument, got 2");
            assertThatThrownBy(() -> ExpressionCompiler.compile("substring(a)"))
                    .hasMessageContaining("substring takes 2 to 3 arguments, got 1");
        }

        @Test
        void syntaxErrors() {
            assertThatThrownBy(() -> ExpressionCompiler.compile("title = 'x'"))
                    .isInstanceOf(ExpressionError.class)
                    .hasMessageContaining("single '='");
            assertThatThrownBy(() -> ExpressionCompiler.compile("(a + b"))
                    .hasMessageContaining("Expected RPAREN but got end of expression");
            assertThatThrownBy(() -> ExpressionCompiler.compile("'open")).hasMessageContaining("Unterminated string");
            assertThatThrownBy(() -> ExpressionCompiler.compile("1 < 2 < 3")).hasMessageContaining("can't be chained");
            assertThatThrownBy(() -> ExpressionCompiler.compile("  ")).hasMessageContaining("Empty expression");
            assertThatThrownBy(() -> ExpressionCompiler.compile("a b")).hasMessageContaining("Unexpected 'b'");
        }

        @Test
        void identifiersAreTheRootPathsRead() {
            CompiledExpression expr = ExpressionCompiler.compile(
                    "length(value) <= max(limit, 10) and any(gallery, !isEmpty(it.caption)) and item.caption != title"
                            + " and ref(image).meta.alt != ''");
            assertThat(expr.identifiers()).containsExactly("value", "limit", "gallery", "item.caption", "title", "image");
            assertThat(expr.functions()).containsExactlyInAnyOrder("length", "max", "any", "isEmpty", "ref");
        }

        @Test
        void constantLiteralsAreVisible() {
            assertThat(ExpressionCompiler.compile("'yes'").constant()).contains(json("\"yes\""));
            assertThat(ExpressionCompiler.compile("a == 1").constant()).isEmpty();
        }
    }

    @Nested
    class Evaluation {

        @Test
        void testNeedsABoolean() {
            assertThatThrownBy(() -> test("title", "{\"title\":\"x\"}"))
                    .isInstanceOf(ExpressionError.class)
                    .hasMessageContaining("Expected true or false, got text");
            assertThat(test("!isEmpty(title)", "{\"title\":\"x\"}")).isTrue();
        }

        @Test
        void divisionByZeroIsAnError() {
            assertThatThrownBy(() -> eval("1 / (n - n)", "{\"n\":2}"))
                    .isInstanceOf(ExpressionError.class)
                    .hasMessageContaining("Division by zero");
        }

        @Test
        void theStepBudgetStopsRunawayEvaluation() {
            ObjectNode scope = JsonNodeFactory.instance.objectNode();
            var big = scope.putArray("rows");
            for (int i = 0; i < 5_000; i++) {
                big.addObject().put("n", i);
            }
            CompiledExpression expr = ExpressionCompiler.compile("all(rows, all(rows, it.n >= 0))");
            assertThatThrownBy(() -> expr.evaluate(ExpressionScope.of(scope), ExpressionHost.NONE,
                            new EvaluationBudget(10_000, Duration.ofSeconds(5))))
                    .isInstanceOf(ExpressionError.class)
                    .hasMessageContaining("Evaluation limit exceeded");
        }

        @Test
        void namedRootsShadowContent() {
            ExpressionScope scope = ExpressionScope.of(json("{\"value\":\"content\",\"title\":\"T\"}"))
                    .with(Map.of("value", json("\"rule target\"")));
            assertThat(ExpressionCompiler.compile("value + '/' + title").evaluate(scope).asText()).isEqualTo("rule target/T");
        }
    }

    @Nested
    class VersionOne {

        private final ExpressionEvaluator v1 = new ExpressionEvaluator();

        @Test
        @DisplayName("the v1 quirks stay: a single '=' compares, '!' binds to the whole comparison, text order for mixed types")
        void quirksStay() {
            JsonNode scope = json("{\"a\":1,\"b\":2,\"s\":\"x\"}");
            assertThat(v1.evaluate("a = 1", scope)).isTrue();
            assertThat(v1.evaluate("!a == 2", scope)).as("!(a == 2)").isTrue();
            assertThat(v1.evaluate("s > 1", scope)).as("'x' > '1' as text").isTrue();
            assertThat(v1.evaluate("s in \"xyz\"", scope)).isTrue();
        }

        @Test
        void v2SyntaxIsAParseErrorInV1() {
            assertThatThrownBy(() -> v1.evaluate("length(s) > 1", null)).isInstanceOf(IllegalArgumentException.class);
            assertThatThrownBy(() -> v1.evaluate("a + 1 == 2", null)).isInstanceOf(IllegalArgumentException.class);
            assertThatThrownBy(() -> v1.evaluate("a ? b : c", null)).isInstanceOf(IllegalArgumentException.class);
            assertThatThrownBy(() -> v1.evaluate("a and b", null)).isInstanceOf(IllegalArgumentException.class);
        }

        @Test
        void identifiersAreDottedPaths() {
            assertThat(v1.identifiers("a.b == 1 && c in [1, 2] || !d")).containsExactly("a.b", "c", "d");
        }
    }
}
