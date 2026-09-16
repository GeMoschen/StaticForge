package com.acme.staticforge.template.render;

import static org.assertj.core.api.Assertions.assertThat;

import com.acme.staticforge.template.octl.InMemoryTemplates;
import com.acme.staticforge.template.octl.OctlResult;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.Map;
import org.junit.jupiter.api.Test;

/** {@code M20.3.1}: rendering a linked template — block table, {@code $CMS_PARENT$} at every depth, child sets. */
class InheritanceRenderTest {

    private final OctlRenderer renderer = new OctlRenderer();

    @Test
    void parentRendersTheNextDefinitionAtDepthsOneTwoAndThree() {
        InMemoryTemplates templates = new InMemoryTemplates()
                .add("l0", null, "[$CMS_BLOCK(b)$0$CMS_END_BLOCK$]")
                .add("l1", null, "$CMS_EXTENDS(page_template:l0)$$CMS_BLOCK(b)$1($CMS_PARENT$)$CMS_END_BLOCK$")
                .add("l2", null, "$CMS_EXTENDS(page_template:l1)$$CMS_BLOCK(b)$2($CMS_PARENT$)$CMS_END_BLOCK$")
                .add("l3", null, "$CMS_EXTENDS(page_template:l2)$$CMS_BLOCK(b)$3($CMS_PARENT$)$CMS_END_BLOCK$");

        assertThat(render(templates, "l1")).isEqualTo("[1(0)]");
        assertThat(render(templates, "l2")).isEqualTo("[2(1(0))]");
        assertThat(render(templates, "l3")).isEqualTo("[3(2(1(0)))]");
    }

    @Test
    void overrideWithoutParentReplacesAndRootParentRendersNothing() {
        InMemoryTemplates templates = new InMemoryTemplates()
                .add("base", null, "<$CMS_BLOCK(b)$base$CMS_END_BLOCK$>")
                .add("replace", null, "$CMS_EXTENDS(page_template:base)$$CMS_BLOCK(b)$child$CMS_END_BLOCK$")
                .add("skip", null, "$CMS_EXTENDS(page_template:replace)$$CMS_BLOCK(b)$grand+$CMS_PARENT$$CMS_END_BLOCK$");
        assertThat(render(templates, "replace")).isEqualTo("<child>");
        // skip's $CMS_PARENT$ renders replace's definition, which does not reach base's.
        assertThat(render(templates, "skip")).isEqualTo("<grand+child>");
    }

    @Test
    void innerBlockOverrideRendersThroughAnInheritedOuterBlock() {
        InMemoryTemplates templates = new InMemoryTemplates()
                .add("base", null, "$CMS_BLOCK(outer)$<o>$CMS_BLOCK(inner)$i$CMS_END_BLOCK$</o>$CMS_END_BLOCK$")
                .add("mid", null, "$CMS_EXTENDS(page_template:base)$$CMS_BLOCK(outer)$<m>$CMS_PARENT$</m>$CMS_END_BLOCK$")
                .add("leaf", null, "$CMS_EXTENDS(page_template:mid)$$CMS_BLOCK(inner)$I+$CMS_PARENT$$CMS_END_BLOCK$");
        assertThat(render(templates, "leaf")).isEqualTo("<m><o>I+i</o></m>");
    }

    @Test
    void anOverrideMayDeclareNewInnerBlocksForItsDescendants() {
        InMemoryTemplates templates = new InMemoryTemplates()
                .add("base", null, "$CMS_BLOCK(main)$m$CMS_END_BLOCK$")
                .add("mid", null, "$CMS_EXTENDS(page_template:base)$$CMS_BLOCK(main)$[$CMS_BLOCK(extra)$e$CMS_END_BLOCK$]$CMS_END_BLOCK$")
                .add("leaf", null, "$CMS_EXTENDS(page_template:mid)$$CMS_BLOCK(extra)$E$CMS_END_BLOCK$");
        OctlResult result = templates.compile("leaf", "html");
        assertThat(result.diagnostics()).isEmpty();
        assertThat(render(templates, "leaf")).isEqualTo("[E]");
    }

    @Test
    void childLevelSetsAreEvaluatedBeforeTheLayoutMostDerivedWinning() {
        InMemoryTemplates templates = new InMemoryTemplates()
                .add("base", null, "$CMS_BLOCK(t)$$CMS_END_BLOCK$")
                .add("mid", null, "$CMS_EXTENDS(page_template:base)$$CMS_SET(who = \"mid\")$"
                        + "$CMS_SET(midOnly = \"m\")$$CMS_BLOCK(t)$$CMS_VALUE(who)$/$CMS_VALUE(midOnly)$$CMS_END_BLOCK$")
                .add("leaf", null, "$CMS_EXTENDS(page_template:mid)$$CMS_SET(who = \"leaf\")$"
                        + "$CMS_BLOCK(t)$$CMS_PARENT$|$CMS_VALUE(who)$$CMS_END_BLOCK$");
        assertThat(render(templates, "leaf")).isEqualTo("leaf/m|leaf");
    }

    @Test
    void ancestorsAreRenderDependenciesAndEditorsResolveFromThePage() throws Exception {
        InMemoryTemplates templates = new InMemoryTemplates()
                .add("base", "content { editor text title { label \"T\" } }", "<h1>$CMS_VALUE(title)$</h1>$CMS_BLOCK(c)$$CMS_END_BLOCK$")
                .add("mid", null, "$CMS_EXTENDS(page_template:base)$")
                .add("leaf", null, "$CMS_EXTENDS(page_template:mid)$$CMS_BLOCK(c)$<p>$CMS_VALUE(title)$</p>$CMS_END_BLOCK$");
        OctlResult result = templates.compile("leaf", "html");
        RenderResult rendered = renderer.render(result.template(), RenderContext.builder()
                .values(new ObjectMapper().valueToTree(Map.of("title", "Hi")))
                .build());
        assertThat(rendered.output()).isEqualTo("<h1>Hi</h1><p>Hi</p>");
        assertThat(rendered.dependencies())
                .contains(InMemoryTemplates.uuidOf("mid"), InMemoryTemplates.uuidOf("base"));
    }

    @Test
    void loopCapAppliesToTheWholeLinkedRender() {
        InMemoryTemplates templates = new InMemoryTemplates().add("base", null, "$CMS_BLOCK(c)$$CMS_END_BLOCK$");
        OctlResult result = new com.acme.staticforge.template.octl.OctlCompiler().compile(
                "$CMS_EXTENDS(page_template:base)$$CMS_BLOCK(c)$"
                        + "$CMS_FOR(i : items)$$CMS_FOR(j : items)$$CMS_FOR(k : items)$x$CMS_END_FOR$$CMS_END_FOR$$CMS_END_FOR$"
                        + "$CMS_END_BLOCK$",
                "html", templates.resolver(), templates.loader(), null);
        var items = new ObjectMapper().createArrayNode();
        for (int i = 0; i < 100; i++) {
            items.add(i);
        }
        RenderContext context = RenderContext.builder()
                .values(new ObjectMapper().createObjectNode().set("items", items))
                .build();
        org.assertj.core.api.Assertions.assertThatThrownBy(() -> renderer.render(result.template(), context))
                .isInstanceOf(RenderLimitException.class);
    }

    private String render(InMemoryTemplates templates, String uid) {
        OctlResult result = templates.compile(uid, "html");
        assertThat(result.hasErrors()).as("%s: %s", uid, result.diagnostics()).isFalse();
        return renderer.render(result.template(), RenderContext.builder().build()).output();
    }
}
