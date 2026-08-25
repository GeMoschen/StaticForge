package com.acme.staticforge.template.cdl;

import static org.assertj.core.api.Assertions.assertThat;

import com.acme.staticforge.template.content.BodyDefinition;
import com.acme.staticforge.template.content.EditorDefinition;
import com.acme.staticforge.template.content.EditorType;
import com.acme.staticforge.template.diagnostic.Diagnostic;
import com.acme.staticforge.template.diagnostic.DiagnosticCodes;
import com.fasterxml.jackson.databind.JsonNode;
import java.util.List;
import org.junit.jupiter.api.Test;

class CdlCompilerTest {

    private final CdlCompiler compiler = new CdlCompiler();

    private static final String FULL_EXAMPLE = """
            content {
              group "Headline area" {
                editor text headline {
                  label       "Headline"
                  help        "Shown as H1. Keep it under 60 characters."
                  required
                  maxLength   80
                  default     "New headline"
                }
                editor text kicker {
                  label    "Kicker"
                  maxLength 40
                }
              }

              editor richtext body {
                label    "Body text"
                features [bold, italic, link, list, h2, h3, quote]
                maxChars 4000
              }

              editor media heroImage {
                label      "Hero image"
                mimeTypes  ["image/jpeg", "image/png", "image/webp"]
                minWidth   1200
                required
              }

              editor reference relatedPage {
                label      "Related page"
                assetTypes [PAGE]
                folder     "/products/"
              }

              editor select layout {
                label   "Layout"
                options [
                  { value "left",  label "Image left"  },
                  { value "right", label "Image right" },
                  { value "full",  label "Full bleed"  }
                ]
                default "left"
              }

              editor boolean showCta { label "Show call to action" default false }

              editor list links {
                label "Link list"
                min 0
                max 8
                item {
                  editor text      label  { label "Link text" required }
                  editor link      target { label "Target" }
                }
              }

              editor date publishedOn { label "Published on" format "yyyy-MM-dd" }

              editor catalog related {
                label "Related cards"
                allow ["teaser", "cta_box"]
                min 0
                max 6
              }
            }
            """;

    @Test
    void compilesFullExampleWithoutErrors() {
        CdlResult result = compiler.compile(FULL_EXAMPLE);

        assertThat(result.hasErrors()).isFalse();
        assertThat(result.diagnostics()).isEmpty();

        EditorDefinition headline = result.definition().findEditor("headline").orElseThrow();
        assertThat(headline.type()).isEqualTo(EditorType.TEXT);
        assertThat(headline.required()).isTrue();
        assertThat(headline.maxLength()).isEqualTo(80);
    }

    @Test
    void referenceEditorCarriesAssetTypes() {
        CdlResult result = compiler.compile(FULL_EXAMPLE);

        EditorDefinition relatedPage = result.definition().findEditor("relatedPage").orElseThrow();
        assertThat(relatedPage.type()).isEqualTo(EditorType.REFERENCE);
        assertThat(relatedPage.assetTypes()).containsExactly("PAGE");
    }

    @Test
    void catalogEditorCarriesAllowAndCardinality() {
        CdlResult result = compiler.compile(FULL_EXAMPLE);

        EditorDefinition related = result.definition().findEditor("related").orElseThrow();
        assertThat(related.type()).isEqualTo(EditorType.CATALOG);
        assertThat(related.allow()).containsExactly("teaser", "cta_box");
        assertThat(related.min()).isEqualTo(0);
        assertThat(related.max()).isEqualTo(6);
    }

    @Test
    void listEditorIsRepresentedAsListWithItemEditors() {
        CdlResult result = compiler.compile(FULL_EXAMPLE);

        EditorDefinition links = result.definition().findEditor("links").orElseThrow();
        assertThat(links.type()).isEqualTo(EditorType.LIST);
        assertThat(links.items()).hasSize(2);
        assertThat(links.items().get(0).name()).isEqualTo("label");
        assertThat(links.items().get(1).name()).isEqualTo("target");
        assertThat(result.definition().findEditor("label")).isEmpty();
    }

    @Test
    void parsesBodiesBlock() {
        CdlResult result = compiler.compile("""
                content { editor text title { label "Title" } }
                bodies {
                  body main    { label "Main content" allow ["*"] }
                  body sidebar { label "Sidebar" allow ["teaser", "cta_box"] max 4 }
                }
                """);

        assertThat(result.hasErrors()).isFalse();
        BodyDefinition main = result.definition().findBody("main").orElseThrow();
        assertThat(main.allow()).containsExactly("*");
    }

    @Test
    void duplicateNameAcrossGroupsIsReported() {
        CdlResult result = compiler.compile("""
                content {
                  group "A" { editor text headline { label "One" } }
                  group "B" { editor text headline { label "Two" } }
                }
                """);

        assertThat(result.hasErrors()).isTrue();
        assertThat(codes(result.diagnostics())).contains(DiagnosticCodes.CDL_DUPLICATE_EDITOR);
    }

    @Test
    void reservedNameIsReported() {
        CdlResult result = compiler.compile("content { editor text uid { } }");

        assertThat(result.hasErrors()).isTrue();
        assertThat(codes(result.diagnostics())).contains(DiagnosticCodes.CDL_RESERVED_NAME);
    }

    @Test
    void invalidVisibleWhenExpressionIsReported() {
        CdlResult result = compiler.compile("""
                content { editor text ctaLabel { label "Button label" visibleWhen "==" } }
                """);

        assertThat(result.hasErrors()).isTrue();
        assertThat(codes(result.diagnostics())).contains(DiagnosticCodes.CDL_INVALID_EXPRESSION);
    }

    @Test
    void labelAndDefaultRoundTrip() {
        CdlResult result = compiler.compile("""
                content { editor text headline { label "Über uns" default "New headline" } }
                """);

        EditorDefinition headline = result.definition().findEditor("headline").orElseThrow();
        assertThat(headline.label()).isEqualTo("Über uns");
        JsonNode defaultValue = headline.defaultValue();
        assertThat(defaultValue.isTextual()).isTrue();
        assertThat(defaultValue.asText()).isEqualTo("New headline");
    }

    private static List<String> codes(List<Diagnostic> diagnostics) {
        return diagnostics.stream().map(Diagnostic::code).toList();
    }
}
