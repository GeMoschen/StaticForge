package com.acme.staticforge.template.cdl;

import static org.assertj.core.api.Assertions.assertThat;

import com.acme.staticforge.template.diagnostic.Diagnostic;
import com.acme.staticforge.template.diagnostic.DiagnosticCodes;
import com.acme.staticforge.template.diagnostic.Severity;
import java.util.List;
import org.junit.jupiter.api.Test;

/** {@code M17.1.2}: the extra CDL restrictions a global property set is subject to. */
class GlobalSetCdlRulesTest {

    private static final String CATALOG_AND_BODY =
            """
            content {
              editor text title { label "Site title" required }
              editor catalog cards { label "Cards" allow ["teaser"] }
            }
            bodies {
              body main { label "Main content" allow ["*"] }
            }
            """;

    private final CdlCompiler compiler = new CdlCompiler();

    @Test
    void ordinaryEditorsArePerfectlyFineInASet() {
        assertThat(check("""
                content {
                  editor text title { label "Site title" required }
                  editor media logo { label "Logo" }
                  editor boolean showBanner { label "Show banner" default false }
                  editor list links {
                    label "Social links"
                    item {
                      editor text label { label "Label" required }
                      editor link target { label "Target" }
                    }
                  }
                }
                """))
                .isEmpty();
    }

    @Test
    void aBodyDeclarationIsRejected() {
        assertThat(check("""
                content { editor text title { label "Site title" } }
                bodies { body main { label "Main content" allow ["*"] } }
                """))
                .singleElement()
                .satisfies(d -> {
                    assertThat(d.code()).isEqualTo(DiagnosticCodes.CDL_NOT_ALLOWED_IN_GLOBAL_SET);
                    assertThat(d.severity()).isEqualTo(Severity.ERROR);
                    assertThat(d.message()).contains("main").contains("no page");
                });
    }

    @Test
    void aCatalogEditorIsRejected() {
        assertThat(check("""
                content { editor catalog cards { label "Cards" allow ["teaser"] } }
                """))
                .singleElement()
                .satisfies(d -> {
                    assertThat(d.code()).isEqualTo(DiagnosticCodes.CDL_NOT_ALLOWED_IN_GLOBAL_SET);
                    assertThat(d.message()).contains("cards");
                });
    }

    /** A group is transparent, so a catalog hidden inside one must be found just the same. */
    @Test
    void aCatalogNestedInsideAGroupIsRejectedToo() {
        assertThat(check("""
                content {
                  group "Branding" {
                    editor text title { label "Title" }
                    editor catalog cards { label "Cards" allow ["teaser"] }
                  }
                }
                """))
                .extracting(Diagnostic::code)
                .containsExactly(DiagnosticCodes.CDL_NOT_ALLOWED_IN_GLOBAL_SET);
    }

    @Test
    void bothRestrictionsAreReportedTogether() {
        assertThat(check(CATALOG_AND_BODY)).hasSize(2);
    }

    /** The restriction is a caller-chosen overlay, not a language rule: a template may use both. */
    @Test
    void theSameCdlStaysValidForATemplate() {
        assertThat(compiler.compile(CATALOG_AND_BODY).hasErrors()).isFalse();
    }

    private List<Diagnostic> check(String cdl) {
        CdlResult result = compiler.compile(cdl);
        assertThat(result.hasErrors()).withFailMessage("CDL itself did not compile: %s", result.diagnostics()).isFalse();
        return GlobalSetCdlRules.check(result.definition());
    }
}
