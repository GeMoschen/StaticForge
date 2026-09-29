package com.acme.staticforge.template.octl;

import static org.assertj.core.api.Assertions.assertThat;

import com.acme.staticforge.template.diagnostic.Diagnostic;
import com.acme.staticforge.template.diagnostic.DiagnosticCodes;
import com.acme.staticforge.template.diagnostic.Severity;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

/** {@code M20.1.2}: compiling a page template against its {@code $CMS_EXTENDS} chain. */
class OctlChainCompileTest {

    private static final String BASE = "<html>$CMS_BLOCK(content)$base$CMS_END_BLOCK$|$CMS_BLOCK(footer)$f$CMS_END_BLOCK$</html>";

    @Test
    void twoAndThreeCyclesAreReportedWithTheChain() {
        InMemoryTemplates two = new InMemoryTemplates()
                .add("a", null, "$CMS_EXTENDS(page_template:b)$")
                .add("b", null, "$CMS_EXTENDS(page_template:a)$");
        Diagnostic cycle = single(two.compile("a", "html"), DiagnosticCodes.OCTL_INHERITANCE_CYCLE);
        assertThat(cycle.message()).contains("a → b → a");

        InMemoryTemplates three = new InMemoryTemplates()
                .add("a", null, "$CMS_EXTENDS(page_template:b)$")
                .add("b", null, "$CMS_EXTENDS(page_template:c)$")
                .add("c", null, "$CMS_EXTENDS(page_template:a)$");
        assertThat(single(three.compile("a", "html"), DiagnosticCodes.OCTL_INHERITANCE_CYCLE).message())
                .contains("a → b → c → a");

        InMemoryTemplates self = new InMemoryTemplates().add("a", null, "$CMS_EXTENDS(page_template:a)$");
        assertThat(single(self.compile("a", "html"), DiagnosticCodes.OCTL_INHERITANCE_CYCLE).message()).contains("a → a");
    }

    @Test
    void cycleDetectionKeysOnUuidNotUid() {
        // "a" was renamed to "a2" but the old uid still resolves to the same template: b extends it by the old
        // uid. Keyed on uids the chain a2 → b → a would look acyclic and only stop at the depth cap.
        InMemoryTemplates templates = new InMemoryTemplates()
                .add("a", null, "$CMS_EXTENDS(page_template:b)$")
                .add("b", null, "$CMS_EXTENDS(page_template:a)$");
        templates.rename("a", "a2");
        List<String> codes = codes(templates.compile("a2", "html"));
        assertThat(codes).contains(DiagnosticCodes.OCTL_INHERITANCE_CYCLE).doesNotContain(DiagnosticCodes.OCTL_INHERITANCE_DEPTH);
    }

    @Test
    void depthCapAllowsEightAncestorsNotNine() {
        InMemoryTemplates templates = new InMemoryTemplates().add("t0", null, BASE);
        for (int i = 1; i <= OctlCompiler.MAX_INHERITANCE_DEPTH + 1; i++) {
            templates.add("t" + i, null, "$CMS_EXTENDS(page_template:t" + (i - 1) + ")$");
        }
        OctlResult eight = templates.compile("t" + OctlCompiler.MAX_INHERITANCE_DEPTH, "html");
        assertThat(eight.hasErrors()).isFalse();
        assertThat(eight.template().ancestors()).hasSize(OctlCompiler.MAX_INHERITANCE_DEPTH);

        OctlResult nine = templates.compile("t" + (OctlCompiler.MAX_INHERITANCE_DEPTH + 1), "html");
        assertThat(codes(nine)).contains(DiagnosticCodes.OCTL_INHERITANCE_DEPTH);
    }

    @Test
    void overridingAnUnknownBlockWarnsWithASuggestion() {
        InMemoryTemplates templates = new InMemoryTemplates()
                .add("base", null, BASE)
                .add("child", null, "$CMS_EXTENDS(page_template:base)$$CMS_BLOCK(contnet)$x$CMS_END_BLOCK$");
        OctlResult result = templates.compile("child", "html");
        assertThat(result.hasErrors()).isFalse();
        Diagnostic warning = single(result, DiagnosticCodes.OCTL_UNKNOWN_BLOCK_OVERRIDE);
        assertThat(warning.severity()).isEqualTo(Severity.WARNING);
        assertThat(warning.message()).contains("did you mean 'content'");
    }

    @Test
    void ancestorWithoutTheChannelIsAnError() {
        InMemoryTemplates templates = new InMemoryTemplates()
                .add("base", null, Map.of("html", BASE))
                .add("child", null, Map.of(
                        "html", "$CMS_EXTENDS(page_template:base)$",
                        "markdown", "$CMS_EXTENDS(page_template:base)$"));
        assertThat(templates.compile("child", "html").hasErrors()).isFalse();
        assertThat(single(templates.compile("child", "markdown"), DiagnosticCodes.OCTL_ANCESTOR_MISSING_CHANNEL).message())
                .contains("'base'").contains("'markdown'");
    }

    @Test
    void ownNameCollidingWithAnInheritedOneIsACdlError() {
        InMemoryTemplates templates = new InMemoryTemplates()
                .add("base", "content { editor text title { label \"Title\" } } bodies { body main { label \"Main\" } }",
                        "$CMS_VALUE(title)$$CMS_BODY(main)$")
                .add("docs", "content { editor text subtitle { label \"Sub\" } }",
                        "$CMS_EXTENDS(page_template:base)$$CMS_BLOCK(x)$$CMS_VALUE(subtitle)$$CMS_END_BLOCK$")
                .add("article", "content { group \"Head\" { editor text title { label \"Again\" } } } bodies { body main { label \"M\" } }",
                        "$CMS_EXTENDS(page_template:docs)$");
        List<Diagnostic> collisions = templates.compile("article", "html").diagnostics().stream()
                .filter(d -> d.code().equals(DiagnosticCodes.CDL_INHERITED_NAME_COLLISION))
                .toList();
        assertThat(collisions).hasSize(2);
        assertThat(collisions.get(0).message()).contains("'title'").contains("'base'");
        assertThat(collisions.get(1).message()).contains("Body 'main'");
    }

    @Test
    void ancestorCompileErrorsSurfaceOnceWithTheAncestorUid() {
        InMemoryTemplates templates = new InMemoryTemplates()
                .add("base", null, "$CMS_VALUE(nope | nofilter)$ $CMS_VALUE(missing)$ $CMS_BLOCK(content)$$CMS_END_BLOCK$")
                .add("child", null, "$CMS_EXTENDS(page_template:base)$");
        List<Diagnostic> diagnostics = templates.compile("child", "html").diagnostics();
        assertThat(diagnostics).hasSize(1);
        assertThat(diagnostics.get(0).code()).isEqualTo(DiagnosticCodes.OCTL_ANCESTOR_INVALID);
        assertThat(diagnostics.get(0).message()).contains("'base'");
        assertThat(diagnostics.get(0).line()).isEqualTo(1);
    }

    @Test
    void editorsAndBodiesResolveThroughTheEffectiveDefinition() {
        String cdl = "content { editor text title { label \"Title\" } } bodies { body main { label \"Main\" } }";
        String childSource = "$CMS_EXTENDS(page_template:base)$$CMS_BLOCK(content)$$CMS_VALUE(title)$$CMS_BODY(main)$$CMS_END_BLOCK$";
        InMemoryTemplates templates = new InMemoryTemplates()
                .add("base", cdl, "<h1>$CMS_VALUE(title)$</h1>$CMS_BLOCK(content)$$CMS_BODY(main)$$CMS_END_BLOCK$")
                .add("child", null, childSource);
        OctlResult linked = templates.compile("child", "html");
        assertThat(codes(linked)).isEmpty();
        assertThat(linked.template().effectiveDefinition().editorsInheritedFrom()).containsEntry("title", "base");
        assertThat(linked.template().effectiveDefinition().bodiesInheritedFrom()).containsEntry("main", "base");

        // The same source without the parent's definition fails the name checks.
        OctlResult standalone = new OctlCompiler().compile(
                "$CMS_VALUE(title)$$CMS_BODY(main)$", "html", null, InMemoryTemplates.definition(null));
        assertThat(codes(standalone)).contains(DiagnosticCodes.OCTL_UNKNOWN_EDITOR, DiagnosticCodes.OCTL_BODY_IN_SECTION);
    }

    @Test
    void chainHashChangesWithAnyLayerAndIsStableOtherwise() {
        InMemoryTemplates templates = new InMemoryTemplates()
                .add("base", null, BASE)
                .add("docs", null, "$CMS_EXTENDS(page_template:base)$$CMS_BLOCK(content)$d$CMS_END_BLOCK$")
                .add("article", null, "$CMS_EXTENDS(page_template:docs)$");
        String first = templates.compile("article", "html").template().hash();
        assertThat(templates.compile("article", "html").template().hash()).isEqualTo(first);

        templates.add("base", null, BASE.replace("|", "||"));
        String rootChanged = templates.compile("article", "html").template().hash();
        assertThat(rootChanged).isNotEqualTo(first);

        templates.add("docs", null, "$CMS_EXTENDS(page_template:base)$$CMS_BLOCK(content)$d2$CMS_END_BLOCK$");
        assertThat(templates.compile("article", "html").template().hash()).isNotEqualTo(rootChanged);

        // Without a chain the hash is the one every existing compile produced: sha256(channel   source).
        assertThat(templates.compile("base", "html").template().hash()).isEqualTo(sha256("html " + BASE.replace("|", "||")));
    }

    @Test
    void referencesAndAncestorsAreUnionedAlongTheChain() {
        InMemoryTemplates templates = new InMemoryTemplates()
                .add("base", null, "$CMS_REF(page:home)$$CMS_BLOCK(content)$$CMS_END_BLOCK$")
                .add("child", null, "$CMS_EXTENDS(page_template:base)$$CMS_BLOCK(content)$$CMS_REF(page:about)$$CMS_END_BLOCK$");
        CompiledTemplate compiled = templates.compile("child", "html").template();
        assertThat(compiled.references()).containsKeys("page:home", "page:about", "page_template:base");
        assertThat(compiled.referenceUses()).containsOnlyKeys("page:about");
        assertThat(compiled.ancestors()).containsExactly(
                new CompiledTemplate.Ancestor(InMemoryTemplates.uuidOf("base"), "base"));
        assertThat(compiled.parentUuid()).isEqualTo(InMemoryTemplates.uuidOf("base"));
    }

    @Test
    void blockThatContainsItselfThroughOverridesIsRejected() {
        InMemoryTemplates templates = new InMemoryTemplates()
                .add("base", null, "$CMS_BLOCK(a)$$CMS_BLOCK(b)$$CMS_END_BLOCK$$CMS_END_BLOCK$")
                .add("child", null, "$CMS_EXTENDS(page_template:base)$$CMS_BLOCK(b)$$CMS_BLOCK(a)$$CMS_END_BLOCK$$CMS_END_BLOCK$");
        assertThat(codes(templates.compile("child", "html"))).contains(DiagnosticCodes.OCTL_BLOCK_RECURSION);
    }

    @Test
    void sharedMemoCompilesEachAncestorOnce() {
        InMemoryTemplates templates = new InMemoryTemplates().add("base", null, BASE);
        for (int i = 0; i < 5; i++) {
            templates.add("child" + i, null, "$CMS_EXTENDS(page_template:base)$");
        }
        ChainCompileMemo memo = new ChainCompileMemo();
        for (int i = 0; i < 5; i++) {
            assertThat(templates.compile("child" + i, "html", memo).hasErrors()).isFalse();
        }
        assertThat(templates.loads()).isEqualTo(1);
    }

    @Test
    void withoutALoaderAnExtendingTemplateGetsOneClearDiagnostic() {
        OctlResult result = new OctlCompiler().compile(
                "$CMS_EXTENDS(page_template:base)$$CMS_BLOCK(content)$$CMS_VALUE(inherited)$$CMS_BODY(main)$$CMS_END_BLOCK$",
                "html", new InMemoryTemplates().add("base", null, BASE).resolver(), InMemoryTemplates.definition(null));
        assertThat(codes(result)).containsExactly(DiagnosticCodes.OCTL_PARENT_UNAVAILABLE);
    }

    private static String sha256(String input) {
        try {
            byte[] bytes = java.security.MessageDigest.getInstance("SHA-256")
                    .digest(input.getBytes(java.nio.charset.StandardCharsets.UTF_8));
            return java.util.HexFormat.of().formatHex(bytes);
        } catch (java.security.NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }

    private static Diagnostic single(OctlResult result, String code) {
        List<Diagnostic> matching = result.diagnostics().stream().filter(d -> d.code().equals(code)).toList();
        assertThat(matching).as("diagnostics %s", result.diagnostics()).hasSize(1);
        return matching.get(0);
    }

    private static List<String> codes(OctlResult result) {
        return result.diagnostics().stream().map(Diagnostic::code).toList();
    }
}
