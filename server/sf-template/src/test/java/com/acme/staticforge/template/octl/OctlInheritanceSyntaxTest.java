package com.acme.staticforge.template.octl;

import static org.assertj.core.api.Assertions.assertThat;

import com.acme.staticforge.template.diagnostic.Diagnostic;
import com.acme.staticforge.template.diagnostic.DiagnosticCodes;
import com.acme.staticforge.template.render.OctlRenderer;
import com.acme.staticforge.template.render.RenderContext;
import java.util.List;
import org.junit.jupiter.api.Test;

/** {@code M20.1.1}: parsing {@code $CMS_EXTENDS}/{@code $CMS_BLOCK}/{@code $CMS_PARENT} and the single-source rules. */
class OctlInheritanceSyntaxTest {

    private final OctlCompiler compiler = new OctlCompiler();

    @Test
    void parsesTheThreeInstructionsWithNestedBlocks() {
        OctlResult result = compiler.compile("""
                $CMS_EXTENDS(page_template:base)$
                $CMS_BLOCK(content)$
                  $CMS_PARENT$
                  $CMS_BLOCK(inner)$x$CMS_END_BLOCK$
                $CMS_END_BLOCK$
                """, "html", null);

        List<OctlNode> nodes = result.template().nodes();
        OctlNode.Extends extendsNode = (OctlNode.Extends) nodes.get(0);
        assertThat(extendsNode.accessor().referenceKey()).isEqualTo("page_template:base");
        assertThat(extendsNode.line()).isEqualTo(1);
        OctlNode.Block content = (OctlNode.Block) nodes.stream().filter(OctlNode.Block.class::isInstance).findFirst().orElseThrow();
        assertThat(content.name()).isEqualTo("content");
        assertThat(content.body()).anyMatch(node -> node instanceof OctlNode.Parent parent && !parent.hasArguments());
        assertThat(content.body()).anyMatch(node -> node instanceof OctlNode.Block inner && inner.name().equals("inner"));
        // Without a loader, the only complaint is that the parent can't be loaded.
        assertThat(codes(result)).containsExactly(DiagnosticCodes.OCTL_PARENT_UNAVAILABLE);
    }

    @Test
    void unbalancedBlockIsReported() {
        assertThat(codes(compiler.compile("$CMS_BLOCK(a)$ never closed", "html", null)))
                .containsExactly(DiagnosticCodes.OCTL_UNBALANCED_BLOCK);
    }

    @Test
    void extendsMustBeFirstAndOnce() {
        assertThat(codes(compiler.compile("<p>hi</p>$CMS_EXTENDS(page_template:base)$", "html", null)))
                .contains(DiagnosticCodes.OCTL_EXTENDS_POSITION);
        assertThat(codes(compiler.compile(
                        "$CMS_EXTENDS(page_template:a)$$CMS_EXTENDS(page_template:b)$", "html", null)))
                .contains(DiagnosticCodes.OCTL_EXTENDS_POSITION);
        assertThat(codes(compiler.compile(
                        "$CMS_IF(true)$$CMS_EXTENDS(page_template:a)$$CMS_END_IF$", "html", null)))
                .contains(DiagnosticCodes.OCTL_EXTENDS_POSITION);
        // Leading whitespace and comments are fine.
        assertThat(codes(compiler.compile(
                        "\n  $CMS_COMMENT$ layout $CMS_END_COMMENT$\n$CMS_EXTENDS(page_template:a)$", "html", null)))
                .doesNotContain(DiagnosticCodes.OCTL_EXTENDS_POSITION);
    }

    @Test
    void contentOutsideBlocksInAnExtendingTemplate() {
        List<Diagnostic> diagnostics = compiler.compile("""
                $CMS_EXTENDS(page_template:base)$
                $CMS_SET(title = "Docs")$
                $CMS_COMMENT$ fine $CMS_END_COMMENT$
                <p>stray</p>
                $CMS_VALUE(title)$
                $CMS_BLOCK(content)$ok$CMS_END_BLOCK$
                """, "html", null).diagnostics();

        List<Diagnostic> outside = diagnostics.stream()
                .filter(d -> d.code().equals(DiagnosticCodes.OCTL_CONTENT_OUTSIDE_BLOCK))
                .toList();
        assertThat(outside).hasSize(2);
        assertThat(outside.get(0).message()).contains("<p>stray</p>");
        assertThat(outside.get(1).line()).isEqualTo(5);
    }

    @Test
    void blockNamesAreIdentifiersAndUniqueIncludingNested() {
        assertThat(codes(compiler.compile("$CMS_BLOCK(a)$$CMS_BLOCK(a)$$CMS_END_BLOCK$$CMS_END_BLOCK$", "html", null)))
                .containsExactly(DiagnosticCodes.OCTL_BLOCK_NAME);
        assertThat(codes(compiler.compile("$CMS_BLOCK(a)$$CMS_END_BLOCK$$CMS_BLOCK(a)$$CMS_END_BLOCK$", "html", null)))
                .containsExactly(DiagnosticCodes.OCTL_BLOCK_NAME);
        assertThat(codes(compiler.compile("$CMS_BLOCK(1st)$$CMS_END_BLOCK$", "html", null)))
                .containsExactly(DiagnosticCodes.OCTL_BLOCK_NAME);
    }

    @Test
    void blockAndEditorNamesDontShareANamespace() {
        OctlResult result = compiler.compile(
                "$CMS_BLOCK(header)$$CMS_VALUE(header)$$CMS_END_BLOCK$", "html", null,
                InMemoryTemplates.definition("content { editor text header { label \"Header\" } }"));
        assertThat(codes(result)).isEmpty();
    }

    @Test
    void parentMisuse() {
        assertThat(codes(compiler.compile("$CMS_PARENT$", "html", null)))
                .containsExactly(DiagnosticCodes.OCTL_PARENT_MISUSE);
        assertThat(codes(compiler.compile("$CMS_BLOCK(a)$$CMS_PARENT$$CMS_END_BLOCK$", "html", null)))
                .containsExactly(DiagnosticCodes.OCTL_PARENT_MISUSE);
        assertThat(codes(compiler.compile(
                        "$CMS_EXTENDS(page_template:b)$$CMS_BLOCK(a)$$CMS_PARENT(x)$$CMS_END_BLOCK$", "html", null)))
                .contains(DiagnosticCodes.OCTL_PARENT_MISUSE);
    }

    @Test
    void extendsTargetMustBeAPageTemplate() {
        assertThat(codes(compiler.compile("$CMS_EXTENDS(section_template:x)$", "html", null)))
                .containsExactly(DiagnosticCodes.OCTL_EXTENDS_TARGET);
        assertThat(codes(compiler.compile("$CMS_EXTENDS(nav:x)$", "html", null)))
                .containsExactly(DiagnosticCodes.OCTL_EXTENDS_TARGET);
        assertThat(codes(compiler.compile("$CMS_EXTENDS(page_template:x.title)$", "html", null)))
                .containsExactly(DiagnosticCodes.OCTL_EXTENDS_TARGET);
    }

    @Test
    void unresolvableParentIsAnUnresolvableReference() {
        OctlResult result = new OctlCompiler().compile(
                "$CMS_EXTENDS(page_template:missing)$", "html", new InMemoryTemplates().resolver(),
                new InMemoryTemplates().loader(), null);
        assertThat(codes(result)).containsExactly(DiagnosticCodes.OCTL_UNRESOLVABLE_REF);
    }

    @Test
    void notAllowedInTextMedia() {
        assertThat(codes(compiler.compileTextMedia("$CMS_EXTENDS(page_template:a)$", "html", null, false)))
                .contains(DiagnosticCodes.OCTL_NOT_ALLOWED_IN_TEXT_MEDIA);
    }

    @Test
    void aTemplateWithBlocksButNoExtendsRendersEachBlockInPlace() {
        OctlResult result = compiler.compile(
                "<body>$CMS_BLOCK(header)$<h1>Site</h1>$CMS_END_BLOCK$|$CMS_BLOCK(content)$"
                        + "<main>$CMS_BLOCK(inner)$in$CMS_END_BLOCK$</main>$CMS_END_BLOCK$</body>",
                "html", null);
        assertThat(result.hasErrors()).isFalse();
        String html = new OctlRenderer().render(result.template(), RenderContext.builder().build()).output();
        assertThat(html).isEqualTo("<body><h1>Site</h1>|<main>in</main></body>");
    }

    @Test
    void newDiagnosticCodesAreCatalogued() {
        assertThat(List.of(
                        DiagnosticCodes.OCTL_EXTENDS_POSITION, DiagnosticCodes.OCTL_CONTENT_OUTSIDE_BLOCK,
                        DiagnosticCodes.OCTL_BLOCK_NAME, DiagnosticCodes.OCTL_PARENT_MISUSE,
                        DiagnosticCodes.OCTL_INHERITANCE_CYCLE, DiagnosticCodes.OCTL_INHERITANCE_DEPTH,
                        DiagnosticCodes.OCTL_EXTENDS_TARGET, DiagnosticCodes.OCTL_UNKNOWN_BLOCK_OVERRIDE,
                        DiagnosticCodes.OCTL_ANCESTOR_MISSING_CHANNEL, DiagnosticCodes.OCTL_CHANNELS_EXTEND_DIFFERENT_PARENTS,
                        DiagnosticCodes.OCTL_ANCESTOR_INVALID, DiagnosticCodes.OCTL_PARENT_UNAVAILABLE,
                        DiagnosticCodes.OCTL_BLOCK_RECURSION, DiagnosticCodes.OCTL_INCLUDE_DEPTH, DiagnosticCodes.OCTL_LOOP_LIMIT))
                .doesNotHaveDuplicates()
                .allMatch(code -> code.startsWith("SF-TPL-0"));
    }

    private static List<String> codes(OctlResult result) {
        return result.diagnostics().stream().map(Diagnostic::code).toList();
    }
}
