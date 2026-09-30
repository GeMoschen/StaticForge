package com.acme.staticforge.template.cdl;

import static org.assertj.core.api.Assertions.assertThat;

import com.acme.staticforge.template.diagnostic.Diagnostic;
import com.acme.staticforge.template.diagnostic.DiagnosticCodes;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.junit.jupiter.api.Test;

/** M34: a definition edited and stored as its content, bodies and rules sections. */
class CdlSourcesTest {

    private final CdlCompiler compiler = new CdlCompiler();

    @Test
    void sectionsCompileToTheSameDefinitionAsTheWholeText() {
        String whole = """
                content {
                  editor text title { label "Title" required }
                }
                bodies {
                  body main { label "Main" allow ["*"] }
                }
                rules {
                  rule "short" on title { level warning scope [edit] assert "true" message { en "Too long" } }
                }
                """;
        CdlResult fromText = compiler.compile(whole);
        CdlResult fromSections = compiler.compile(CdlSources.split(whole));

        assertThat(fromText.diagnostics()).isEmpty();
        assertThat(fromSections.diagnostics()).isEmpty();
        assertThat(fromSections.definition().editors()).isEqualTo(fromText.definition().editors());
        assertThat(fromSections.definition().bodies()).isEqualTo(fromText.definition().bodies());
        assertThat(fromSections.definition().rules().rules()).hasSize(1);
    }

    @Test
    void diagnosticsNameTheirSectionAndALineInsideIt() {
        CdlSources sources = new CdlSources(
                "editor text title { label \"Title\" }",
                "",
                "rule \"r\" on title {\n  bogus \"x\"\n}");

        CdlResult result = compiler.compile(sources);

        assertThat(result.diagnostics()).isNotEmpty().allSatisfy(d -> {
            assertThat(d.field()).isEqualTo(CdlSources.RULES);
            assertThat(d.line()).isBetween(1, 3);
        });
    }

    @Test
    void aSectionCannotCloseItselfEarly() {
        // A stray '}' would otherwise end `content` and let the text open a section of its own.
        CdlSources sources = CdlSources.content("editor text title { label \"T\" } } rules { rule \"r\" on title { assert \"true\" } }");

        CdlResult result = compiler.compile(sources);

        assertThat(result.hasErrors()).isTrue();
        assertThat(result.diagnostics()).anySatisfy(d -> {
            assertThat(d.message()).isEqualTo("Unmatched '}'");
            assertThat(d.field()).isEqualTo(CdlSources.CONTENT);
            assertThat(d.line()).isEqualTo(1);
        });
        assertThat(result.definition().rules().rules()).isEmpty();
    }

    @Test
    void anUnclosedBraceIsReportedAtTheEndOfItsSection() {
        CdlResult result = compiler.compile(CdlSources.content("editor text title {\n  label \"T\"\n"));

        assertThat(result.diagnostics()).anySatisfy(d -> {
            assertThat(d.message()).isEqualTo("Missing '}'");
            assertThat(d.field()).isEqualTo(CdlSources.CONTENT);
        });
    }

    @Test
    void emptyBodiesAndRulesSectionsAreLeftOut() {
        CdlResult result = compiler.compile(new CdlSources("editor text title { }", "  // none yet\n", ""));

        assertThat(result.diagnostics()).isEmpty();
        assertThat(result.definition().bodies()).isEmpty();
    }

    @Test
    void splitDedentsEachSectionAndDropsItsBraces() {
        CdlSources sources = CdlSources.split("""
                content {
                  editor text title { label "Title" }
                  editor text lead { label "Lead" }
                }
                bodies { body main { } }
                """);

        assertThat(sources.content()).isEqualTo("editor text title { label \"Title\" }\neditor text lead { label \"Lead\" }");
        assertThat(sources.bodies()).isEqualTo("body main { }");
        assertThat(sources.rules()).isEmpty();
    }

    @Test
    void payloadRoundTripsThroughItsThreeFields() {
        ObjectNode payload = new ObjectMapper().createObjectNode();
        CdlSources sources = new CdlSources("editor text a { }", "body main { }", "");

        sources.writeTo(payload);

        assertThat(payload.path(CdlSources.CONTENT_FIELD).asText()).isEqualTo("editor text a { }");
        assertThat(CdlSources.presentIn(payload)).isTrue();
        assertThat(CdlSources.of(payload)).isEqualTo(sources);
        assertThat(CdlSources.presentIn(new ObjectMapper().createObjectNode())).isFalse();
    }

    @Test
    void aPlainDiagnosticHasNoField() {
        Diagnostic plain = Diagnostic.error(DiagnosticCodes.CDL_SYNTAX, "x", 3, 1);

        assertThat(plain.field()).isNull();
        assertThat(plain.line()).isEqualTo(3);
        assertThat(plain.inField("channel:html").field()).isEqualTo("channel:html");
    }
}
