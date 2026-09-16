package com.acme.staticforge.template.cdl;

import static org.assertj.core.api.Assertions.assertThat;

import com.acme.staticforge.template.content.ContentDefinition;
import com.acme.staticforge.template.content.EditorDefinition;
import com.acme.staticforge.template.content.EditorType;
import com.acme.staticforge.template.content.EffectiveDefinition;
import com.acme.staticforge.template.content.PaginationOptions;
import com.acme.staticforge.template.diagnostic.Diagnostic;
import com.acme.staticforge.template.diagnostic.DiagnosticCodes;
import java.util.List;
import org.junit.jupiter.api.Test;

/** The {@code pagination} editor type in CDL (M21.1.1): attributes, defaults, placement and the one-per-page rule. */
class PaginationCdlTest {

    private final CdlCompiler compiler = new CdlCompiler();

    @Test
    void compilesEveryAttribute() {
        CdlResult result = compiler.compile("""
                content {
                  editor pagination posts {
                    label "Blog posts"
                    sources ["nav", "dataset"]
                    pageSize 10
                    maxPageSize 50
                    sort ["navigation", "date", "displayName"]
                  }
                }
                """);

        assertThat(result.diagnostics()).isEmpty();
        EditorDefinition posts = result.definition().findEditor("posts").orElseThrow();
        assertThat(posts.type()).isEqualTo(EditorType.PAGINATION);
        assertThat(posts.label()).isEqualTo("Blog posts");
        assertThat(posts.pagination()).isEqualTo(
                new PaginationOptions(List.of("nav", "dataset"), 10, 50, List.of("navigation", "date", "displayName")));
    }

    @Test
    void defaultsToANavigationSourceInTreeOrder() {
        CdlResult result = compiler.compile("content { editor pagination posts { } }");

        assertThat(result.diagnostics()).isEmpty();
        PaginationOptions options = result.definition().findEditor("posts").orElseThrow().pagination();
        assertThat(options.sources()).containsExactly("nav");
        assertThat(options.pageSize()).isEqualTo(PaginationOptions.DEFAULT_PAGE_SIZE);
        assertThat(options.maxPageSize()).isNull();
        assertThat(options.effectiveMaxPageSize()).isEqualTo(PaginationOptions.MAX_PAGE_SIZE);
        assertThat(options.sort()).containsExactly("navigation");
    }

    @Test
    void otherEditorsHaveNoPaginationOptions() {
        CdlResult result = compiler.compile("content { editor text title { } }");

        assertThat(result.definition().findEditor("title").orElseThrow().pagination()).isNull();
    }

    @Test
    void rejectsPaginationAttributesOnOtherEditors() {
        assertThat(codes("content { editor text title { pageSize 5 } }")).containsExactly(DiagnosticCodes.CDL_INVALID_ATTRIBUTE);
    }

    @Test
    void rejectsUnknownSourcesAndOutOfRangeSizes() {
        assertThat(codes("content { editor pagination p { sources [\"feed\"] } }"))
                .containsExactly(DiagnosticCodes.CDL_INVALID_ATTRIBUTE);
        assertThat(codes("content { editor pagination p { sources [] } }"))
                .containsExactly(DiagnosticCodes.CDL_INVALID_ATTRIBUTE);
        assertThat(codes("content { editor pagination p { pageSize 0 } }"))
                .containsExactly(DiagnosticCodes.CDL_INVALID_ATTRIBUTE);
        assertThat(codes("content { editor pagination p { pageSize 1001 } }"))
                .containsExactly(DiagnosticCodes.CDL_INVALID_ATTRIBUTE);
        assertThat(codes("content { editor pagination p { pageSize 20 maxPageSize 10 } }"))
                .containsExactly(DiagnosticCodes.CDL_INVALID_ATTRIBUTE);
    }

    @Test
    void navigationOnlyEditorsSortByNavigationKeys() {
        assertThat(codes("content { editor pagination p { sort [\"title\"] } }"))
                .containsExactly(DiagnosticCodes.CDL_INVALID_ATTRIBUTE);
        // A dataset source may sort by any field name; the schema is checked when a page picks a dataset.
        assertThat(codes("content { editor pagination p { sources [\"dataset\"] sort [\"title\", \"_changedAt\"] } }"))
                .isEmpty();
    }

    @Test
    void allowsOnePaginationEditorPerDefinition() {
        List<Diagnostic> diagnostics = compiler.compile("""
                content {
                  editor pagination posts { }
                  editor pagination more { }
                }
                """).diagnostics();

        assertThat(diagnostics).extracting(Diagnostic::code).containsExactly(DiagnosticCodes.CDL_PAGINATION_DUPLICATE);
        assertThat(diagnostics.get(0).line()).isEqualTo(3);
    }

    @Test
    void rejectsPaginationInsideListsAndGroups() {
        assertThat(codes("""
                content {
                  editor list teasers { item { editor pagination posts { } } }
                }
                """)).containsExactly(DiagnosticCodes.CDL_PAGINATION_PLACEMENT);
        assertThat(codes("""
                content {
                  group "Listing" { editor pagination posts { } }
                }
                """)).containsExactly(DiagnosticCodes.CDL_PAGINATION_PLACEMENT);
    }

    @Test
    void sectionTemplatesPropertySetsAndDatasetsRejectPagination() {
        ContentDefinition definition = compiler.compile("content { editor pagination posts { } }").definition();

        assertThat(PaginationCdlRules.notAllowedIn(definition, "a section template"))
                .extracting(Diagnostic::code)
                .containsExactly(DiagnosticCodes.CDL_PAGINATION_PLACEMENT);
        assertThat(GlobalSetCdlRules.check(definition))
                .extracting(Diagnostic::code)
                .containsExactly(DiagnosticCodes.CDL_PAGINATION_PLACEMENT);
        assertThat(DatasetCdlRules.check(definition))
                .extracting(Diagnostic::code)
                .containsExactly(DiagnosticCodes.CDL_PAGINATION_PLACEMENT);
        assertThat(PaginationCdlRules.notAllowedIn(compiler.compile("content { editor text t { } }").definition(), "x"))
                .isEmpty();
    }

    @Test
    void aTemplateCannotAddASecondPaginationEditorToAnInheritedOne() {
        ContentDefinition parent = compiler.compile("content { editor pagination posts { } }").definition();
        ContentDefinition child = compiler.compile("content { editor pagination more { } editor text intro { } }").definition();

        EffectiveDefinition effective = EffectiveDefinition.merge(List.of(
                new EffectiveDefinition.Layer("layout", parent), new EffectiveDefinition.Layer("blog", child)));

        assertThat(effective.diagnostics()).extracting(Diagnostic::code).containsExactly(DiagnosticCodes.CDL_PAGINATION_DUPLICATE);
        assertThat(effective.diagnostics().get(0).message()).contains("layout");
        assertThat(effective.definition().editors()).extracting(EditorDefinition::name).containsExactly("posts", "intro");
    }

    private List<String> codes(String source) {
        return compiler.compile(source).diagnostics().stream().map(Diagnostic::code).toList();
    }
}
