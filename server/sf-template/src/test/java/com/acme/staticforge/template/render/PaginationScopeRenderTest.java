package com.acme.staticforge.template.render;

import static org.assertj.core.api.Assertions.assertThat;

import com.acme.staticforge.template.cdl.CdlCompiler;
import com.acme.staticforge.template.content.ContentDefinition;
import com.acme.staticforge.template.diagnostic.Diagnostic;
import com.acme.staticforge.template.diagnostic.DiagnosticCodes;
import com.acme.staticforge.template.octl.OctlCompiler;
import com.acme.staticforge.template.octl.OctlResult;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.List;
import org.junit.jupiter.api.Test;

/** The {@code CMS_PAGINATION} root in the compiler and renderer (M21.3.1), beyond the golden cases. */
class PaginationScopeRenderTest {

    private final OctlCompiler compiler = new OctlCompiler();
    private final Renderer renderer = new OctlRenderer();
    private final ContentDefinition definition = new CdlCompiler().compile("content { editor text title { } }").definition();

    @Test
    void compilesWithoutUnknownEditorInPageAndSectionTemplates() {
        String source = "$CMS_FOR(post : CMS_PAGINATION.items)$$CMS_VALUE(post.label)$$CMS_END_FOR$"
                + "$CMS_IF(CMS_PAGINATION.nextHref)$next$CMS_END_IF$$CMS_VALUE(title)$";

        assertThat(compiler.compile(source, "html", null, definition).diagnostics()).isEmpty();
    }

    @Test
    void rendersEmptyOnAPageThatIsNotPaginated() {
        OctlResult result = compiler.compile(
                "[$CMS_VALUE(CMS_PAGINATION.current)$]$CMS_IF(CMS_PAGINATION)$paginated$CMS_ELSE$single$CMS_END_IF$"
                        + "$CMS_FOR(post : CMS_PAGINATION.items)$x$CMS_END_FOR$[$CMS_META(pageNumber)$]",
                "html", null, definition);

        assertThat(renderer.render(result.template(), RenderContext.builder().build()).output()).isEqualTo("[]single[]");
    }

    @Test
    void readsMetaPageNumbers() throws Exception {
        OctlResult result = compiler.compile(
                "$CMS_META(pageNumber)$/$CMS_META(totalPages)$ $CMS_IF(CMS_PAGINATION)$paginated$CMS_END_IF$", "html", null, definition);
        RenderContext context = RenderContext.builder()
                .meta("pageNumber", com.fasterxml.jackson.databind.node.IntNode.valueOf(2))
                .meta("totalPages", com.fasterxml.jackson.databind.node.IntNode.valueOf(3))
                .pagination(new ObjectMapper().readTree("{\"current\":2,\"total\":3,\"items\":[]}"))
                .build();

        assertThat(renderer.render(result.template(), context).output()).isEqualTo("2/3 paginated");
    }

    @Test
    void isReadOnly() {
        List<String> codes = List.of(
                        "$CMS_SET(CMS_PAGINATION = title)$",
                        "$CMS_FOR(CMS_PAGINATION : title)$x$CMS_END_FOR$")
                .stream()
                .flatMap(source -> compiler.compile(source, "html", null, definition).diagnostics().stream())
                .map(Diagnostic::code)
                .toList();

        assertThat(codes).containsExactly(DiagnosticCodes.OCTL_PAGINATION_READ_ONLY, DiagnosticCodes.OCTL_PAGINATION_READ_ONLY);
    }

    @Test
    void isNotAvailableInTextMedia() {
        OctlResult result = compiler.compileTextMedia("$CMS_VALUE(CMS_PAGINATION.current)$", "html", null, false);

        assertThat(result.diagnostics()).extracting(Diagnostic::code).contains(DiagnosticCodes.OCTL_NOT_ALLOWED_IN_TEXT_MEDIA);
    }
}
