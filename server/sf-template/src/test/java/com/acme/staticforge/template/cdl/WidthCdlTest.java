package com.acme.staticforge.template.cdl;

import static org.assertj.core.api.Assertions.assertThat;

import com.acme.staticforge.template.content.ContentDefinition;
import com.acme.staticforge.template.content.EditorDefinition;
import com.acme.staticforge.template.content.EffectiveDefinition;
import com.acme.staticforge.template.diagnostic.Diagnostic;
import com.acme.staticforge.template.diagnostic.DiagnosticCodes;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.List;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/** The {@code width} editor attribute (M35.17): {@code width half} pairs a field with the next half field in the form. */
class WidthCdlTest {

    private final CdlCompiler compiler = new CdlCompiler();
    private final ObjectMapper json = new ObjectMapper();

    private static EditorDefinition editor(CdlResult result, String name) {
        return result.definition().editors().stream()
                .filter(e -> e.name().equals(name))
                .findFirst()
                .orElseThrow(() -> new AssertionError("No editor '" + name + "'"));
    }

    private List<String> codes(String source) {
        return compiler.compile(source).diagnostics().stream().map(Diagnostic::code).toList();
    }

    @Test
    @DisplayName("width half is parsed on a leaf editor, as a word or a string")
    void halfIsParsed() {
        CdlResult result = compiler.compile(
                """
                content {
                  editor number price { label "Price" width half }
                  editor date start { width "half" }
                  editor textarea body { }
                }
                """);

        assertThat(result.diagnostics()).isEmpty();
        assertThat(editor(result, "price").width()).isEqualTo("half");
        assertThat(editor(result, "start").width()).isEqualTo("half");
        assertThat(editor(result, "body").width()).isNull();
    }

    @Test
    @DisplayName("width full is the default and is not stored")
    void fullIsTheDefault() {
        CdlResult result = compiler.compile("content { editor text title { width full } }");

        assertThat(result.diagnostics()).isEmpty();
        assertThat(editor(result, "title").width()).isNull();
    }

    @Test
    @DisplayName("any other value is rejected with SF-CDL-0120")
    void invalidValue() {
        assertThat(codes("content { editor text title { width wide } }")).containsExactly(DiagnosticCodes.CDL_INVALID_WIDTH);
        assertThat(codes("content { editor text title { width 2 } }")).contains(DiagnosticCodes.CDL_INVALID_WIDTH);
        assertThat(codes("content { editor text title { width } }")).contains(DiagnosticCodes.CDL_INVALID_WIDTH);
    }

    @Test
    @DisplayName("a structural editor cannot have a width, its leaves can")
    void containersReject() {
        for (String type : List.of("group", "catalog", "pagination")) {
            assertThat(codes("content { editor " + type + " x { width half } }"))
                    .as(type)
                    .contains(DiagnosticCodes.CDL_INVALID_WIDTH);
        }
        assertThat(codes("content { editor list rows { width half item { editor text a { } } } }"))
                .contains(DiagnosticCodes.CDL_INVALID_WIDTH);

        CdlResult leaves = compiler.compile(
                """
                content {
                  group "Pricing" {
                    editor number price { width half }
                    editor number tax { width half }
                  }
                  editor list rows { item { editor text caption { width half } } }
                }
                """);
        assertThat(leaves.diagnostics()).isEmpty();
        EditorDefinition group = leaves.definition().editors().get(0);
        assertThat(group.items()).extracting(EditorDefinition::width).containsExactly("half", "half");
        assertThat(editor(leaves, "rows").items().get(0).width()).isEqualTo("half");
    }

    @Test
    @DisplayName("the compiled JSON carries width only when it is half")
    void jsonOutput() throws Exception {
        CdlResult result = compiler.compile("content { editor number price { width half } editor text name { } }");

        JsonNode tree = json.valueToTree(result.definition());
        JsonNode editors = tree.get("editors");
        assertThat(editors.get(0).get("width").asText()).isEqualTo("half");
        assertThat(editors.get(1).has("width")).isFalse();
        assertThat(json.writeValueAsString(result.definition())).contains("\"width\":\"half\"");
    }

    @Test
    @DisplayName("an inherited editor keeps its width in the merged definition")
    void inheritanceKeepsWidth() {
        ContentDefinition parent = compiler.compile("content { editor number price { width half } }").definition();
        ContentDefinition child = compiler.compile("content { editor number tax { width half } editor text note { } }").definition();

        EffectiveDefinition effective = EffectiveDefinition.merge(List.of(
                new EffectiveDefinition.Layer("base", parent), new EffectiveDefinition.Layer("child", child)));

        assertThat(effective.diagnostics()).isEmpty();
        assertThat(effective.definition().editors())
                .extracting(EditorDefinition::name, EditorDefinition::width)
                .containsExactly(
                        org.assertj.core.groups.Tuple.tuple("price", "half"),
                        org.assertj.core.groups.Tuple.tuple("tax", "half"),
                        org.assertj.core.groups.Tuple.tuple("note", null));
    }
}
