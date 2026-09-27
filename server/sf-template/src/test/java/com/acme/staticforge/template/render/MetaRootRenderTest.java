package com.acme.staticforge.template.render;

import static org.assertj.core.api.Assertions.assertThat;

import com.acme.staticforge.template.cdl.CdlCompiler;
import com.acme.staticforge.template.content.ContentDefinition;
import com.acme.staticforge.template.diagnostic.Diagnostic;
import com.acme.staticforge.template.diagnostic.DiagnosticCodes;
import com.acme.staticforge.template.octl.OctlCompiler;
import com.acme.staticforge.template.octl.OctlResult;
import com.fasterxml.jackson.databind.node.BooleanNode;
import com.fasterxml.jackson.databind.node.TextNode;
import java.util.List;
import org.junit.jupiter.api.Test;

/**
 * The {@code CMS_META} expression root (M30.2.2): {@code $CMS_IF(CMS_META.noIndex)$} lets a template write the robots
 * meta only for a page that asks search engines not to index it.
 */
class MetaRootRenderTest {

    private static final String ROBOTS =
            "$CMS_IF(CMS_META.noIndex)$<meta name=\"robots\" content=\"noindex\">$CMS_END_IF$[$CMS_META(noIndex)$]";

    private final OctlCompiler compiler = new OctlCompiler();
    private final Renderer renderer = new OctlRenderer();
    private final ContentDefinition definition = new CdlCompiler().compile("content { editor text title { } }").definition();

    @Test
    void compilesWithoutUnknownEditor() {
        assertThat(compiler.compile(ROBOTS + "$CMS_VALUE(CMS_META.uid)$$CMS_VALUE(title)$", "html", null, definition)
                        .diagnostics())
                .isEmpty();
        assertThat(compiler.compileTextMedia("$CMS_IF(CMS_META.uid)$x$CMS_END_IF$", "html", null, false).diagnostics())
                .isEmpty();
    }

    @Test
    void testsAndPrintsTheMetaValues() {
        OctlResult result = compiler.compile(ROBOTS, "html", null, definition);

        assertThat(render(result, true)).isEqualTo("<meta name=\"robots\" content=\"noindex\">[true]");
        assertThat(render(result, false)).isEqualTo("[false]");
    }

    @Test
    void readsNestedAndMissingKeysAsEmpty() {
        OctlResult result = compiler.compile(
                "[$CMS_VALUE(CMS_META.uid | upper)$][$CMS_VALUE(CMS_META.missing)$][$CMS_VALUE(CMS_META)$]"
                        + "$CMS_IF(CMS_META.missing)$x$CMS_END_IF$",
                "html", null, definition);
        RenderContext context = RenderContext.builder().meta("uid", TextNode.valueOf("about")).build();

        assertThat(renderer.render(result.template(), context).output()).isEqualTo("[ABOUT][][]");
    }

    @Test
    void isReadOnly() {
        List<String> codes = List.of("$CMS_SET(CMS_META = title)$", "$CMS_FOR(CMS_META : title)$x$CMS_END_FOR$")
                .stream()
                .flatMap(source -> compiler.compile(source, "html", null, definition).diagnostics().stream())
                .map(Diagnostic::code)
                .toList();

        assertThat(codes).containsExactly(DiagnosticCodes.OCTL_PAGINATION_READ_ONLY, DiagnosticCodes.OCTL_PAGINATION_READ_ONLY);
    }

    private String render(OctlResult result, boolean noIndex) {
        RenderContext context = RenderContext.builder().meta("noIndex", BooleanNode.valueOf(noIndex)).build();
        return renderer.render(result.template(), context).output();
    }
}
