package com.acme.staticforge.template.cdl;

import static org.assertj.core.api.Assertions.assertThat;

import com.acme.staticforge.template.content.EditorDefinition;
import com.acme.staticforge.template.diagnostic.Diagnostic;
import com.acme.staticforge.template.diagnostic.DiagnosticCodes;
import com.acme.staticforge.template.diagnostic.Severity;
import java.util.List;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/** The {@code localizable} editor attribute (M24.2.1). */
class LocalizableCdlTest {

    private final CdlCompiler compiler = new CdlCompiler();

    private static EditorDefinition editor(CdlResult result, String name) {
        return result.definition().editors().stream()
                .filter(e -> e.name().equals(name))
                .findFirst()
                .orElseThrow(() -> new AssertionError("No editor '" + name + "' in " + result.definition().editors()));
    }

    @Test
    @DisplayName("localizable is parsed as a flag on a leaf editor")
    void parsedOnLeaf() {
        CdlResult result = compiler.compile(
                """
                content {
                  editor text headline { label "Headline" localizable }
                  editor text sku { label "SKU" }
                }
                """);

        assertThat(result.diagnostics()).isEmpty();
        assertThat(editor(result, "headline").localizable()).isTrue();
        assertThat(editor(result, "sku").localizable()).isFalse();
    }

    @Test
    @DisplayName("a leaf inside a list item may be localizable")
    void allowedInsideListItem() {
        CdlResult result = compiler.compile(
                """
                content {
                  editor list links {
                    label "Links"
                    item {
                      editor text caption { label "Caption" localizable }
                      editor link target { label "Target" }
                    }
                  }
                }
                """);

        assertThat(result.diagnostics()).isEmpty();
        EditorDefinition list = editor(result, "links");
        assertThat(list.localizable()).isFalse();
        assertThat(list.items().stream().filter(i -> i.name().equals("caption")).findFirst())
                .hasValueSatisfying(caption -> assertThat(caption.localizable()).isTrue());
    }

    @Test
    @DisplayName("a leaf inside a group may be localizable")
    void allowedInsideGroup() {
        CdlResult result = compiler.compile(
                """
                content {
                  group "Headline area" {
                    editor text headline { label "Headline" localizable }
                  }
                }
                """);

        assertThat(result.diagnostics()).isEmpty();
        assertThat(result.definition().editors())
                .anySatisfy(group -> assertThat(group.items())
                        .anySatisfy(item -> assertThat(item.localizable()).isTrue()));
    }

    @Test
    @DisplayName("localizable on a container editor is SF-CDL-0112")
    void rejectedOnContainers() {
        for (String declaration : List.of(
                "editor list items { label \"Items\" localizable item { editor text t { label \"T\" } } }",
                "editor catalog cards { label \"Cards\" localizable }",
                "editor pagination pages { label \"Pages\" localizable sources [\"dataset:posts\"] }")) {
            CdlResult result = compiler.compile("content {\n  " + declaration + "\n}\n");

            assertThat(result.diagnostics())
                    .as("declaration: %s", declaration)
                    .anySatisfy(d -> {
                        assertThat(d.code()).isEqualTo(DiagnosticCodes.CDL_CONTAINER_NOT_LOCALIZABLE);
                        assertThat(d.severity()).isEqualTo(Severity.ERROR);
                        assertThat(d.message()).contains("cannot be localizable");
                    });
        }
    }

    @Test
    @DisplayName("localizable on a group wrapper is rejected, and the group's leaves survive")
    void rejectedOnGroup() {
        CdlResult result = compiler.compile(
                """
                content {
                  editor group meta {
                    label "Meta"
                    localizable
                    item { editor text title { label "Title" } }
                  }
                }
                """);

        assertThat(result.diagnostics())
                .extracting(Diagnostic::code)
                .contains(DiagnosticCodes.CDL_CONTAINER_NOT_LOCALIZABLE);
        assertThat(editor(result, "meta").localizable()).isFalse();
    }
}
