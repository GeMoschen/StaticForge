package com.acme.staticforge.template.render;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.acme.staticforge.template.diagnostic.DiagnosticCodes;
import com.acme.staticforge.template.octl.CompiledTemplate;
import com.acme.staticforge.template.octl.OctlCompiler;
import com.acme.staticforge.template.octl.OctlResult;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.HashMap;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.Test;

/**
 * `M16.5.1`: guard rails shared across nested renders through one {@link RenderBudget}. A tiny
 * in-memory "pipeline" stands in for {@code GenerationRenderer}/{@code PageRenderService}: its
 * {@link BlockResolver} renders each {@code $CMS_INCLUDE(section_template:uid)$} through a nested
 * {@link Renderer#render} call guarded by {@link RenderBudget#withTemplate}, exactly as they do.
 */
class RenderBudgetTest {

    private static final ObjectMapper MAPPER = new ObjectMapper();

    private final OctlCompiler compiler = new OctlCompiler();
    private final Renderer renderer = new OctlRenderer();
    private final Map<String, UUID> uuids = new HashMap<>();
    private final Map<UUID, String> sources = new HashMap<>();

    @Test
    void directIncludeCycleFailsWith0135NamingTheChain() {
        template("a", "A[$CMS_INCLUDE(section_template:b)$]");
        template("b", "B[$CMS_INCLUDE(section_template:a)$]");

        assertThatThrownBy(() -> renderTopLevel("a", MAPPER.createObjectNode()))
                .isInstanceOfSatisfying(RenderLimitException.class, e -> {
                    assertThat(e.diagnostic().code()).isEqualTo(DiagnosticCodes.OCTL_INCLUDE_CYCLE);
                    assertThat(e.diagnostic().message()).isEqualTo("Include cycle: a → b → a");
                });
    }

    @Test
    void selfIncludeFailsWith0135() {
        template("a", "$CMS_INCLUDE(section_template:a)$");

        assertThatThrownBy(() -> renderTopLevel("a", MAPPER.createObjectNode()))
                .isInstanceOfSatisfying(RenderLimitException.class, e ->
                        assertThat(e.diagnostic().message()).isEqualTo("Include cycle: a → a"));
    }

    @Test
    void sameTemplateIncludedTwiceSideBySideIsNotACycle() {
        template("page", "$CMS_INCLUDE(section_template:x)$+$CMS_INCLUDE(section_template:x)$");
        template("x", "X");

        assertThat(renderTopLevel("page", MAPPER.createObjectNode())).isEqualTo("X+X");
    }

    @Test
    void nonCyclicChainOf32NestedLevelsRendersAnd33FailsWith0130() {
        chain(32);
        assertThat(renderTopLevel("t0", MAPPER.createObjectNode())).endsWith("[t32]");

        chain(33);
        assertThatThrownBy(() -> renderTopLevel("t0", MAPPER.createObjectNode()))
                .isInstanceOfSatisfying(RenderLimitException.class, e ->
                        assertThat(e.diagnostic().code()).isEqualTo(DiagnosticCodes.OCTL_INCLUDE_DEPTH));
    }

    @Test
    void loopIterationsAggregateAcrossNestedIncludes() {
        // 60,000 iterations per section stay under the 100,000 limit on their own; two includes
        // on the same page exceed it in aggregate.
        template("page", "$CMS_INCLUDE(section_template:loop)$$CMS_INCLUDE(section_template:loop2)$");
        template("loop", "$CMS_FOR(i : CMS_PAGE.items)$$CMS_END_FOR$");
        template("loop2", "$CMS_FOR(i : CMS_PAGE.items)$$CMS_END_FOR$");
        ObjectNode page = MAPPER.createObjectNode();
        ArrayNode items = page.putArray("items");
        for (int i = 0; i < 60_000; i++) {
            items.add(i);
        }

        template("single", "$CMS_INCLUDE(section_template:loop)$");
        assertThat(renderTopLevel("single", page)).isEmpty();

        assertThatThrownBy(() -> renderTopLevel("page", page))
                .isInstanceOfSatisfying(RenderLimitException.class, e ->
                        assertThat(e.diagnostic().code()).isEqualTo(DiagnosticCodes.OCTL_LOOP_LIMIT));
    }

    @Test
    void nestedOutputIsChargedOnceAgainstTheAggregateOutputLimit() {
        // A 20 MB section inside a page: charged once it is 20 MB (< 32 MB); double-counting the
        // nested output when the page appends it would wrongly exceed the limit.
        String twentyMb = "x".repeat(20 * 1024 * 1024);
        template("page", "$CMS_INCLUDE(section_template:big)$");
        template("big", "$CMS_VALUE(CMS_PAGE.big | raw)$");
        ObjectNode page = MAPPER.createObjectNode().put("big", twentyMb);

        assertThat(renderTopLevel("page", page)).hasSize(twentyMb.length());

        template("twice", "$CMS_INCLUDE(section_template:big)$$CMS_INCLUDE(section_template:big2)$");
        template("big2", "$CMS_VALUE(CMS_PAGE.big | raw)$");
        assertThatThrownBy(() -> renderTopLevel("twice", page))
                .isInstanceOfSatisfying(RenderLimitException.class, e ->
                        assertThat(e.diagnostic().code()).isEqualTo(DiagnosticCodes.OCTL_OUTPUT_LIMIT));
    }

    @Test
    void standaloneRenderWithoutBudgetStillEnforcesLimits() {
        OctlResult compiled = compiler.compile("$CMS_FOR(i : items)$$CMS_END_FOR$", "html", null);
        ArrayNode items = MAPPER.createArrayNode();
        for (int i = 0; i < 100_001; i++) {
            items.add(i);
        }
        RenderContext context = RenderContext.builder().values(MAPPER.createObjectNode().set("items", items)).build();

        assertThatThrownBy(() -> renderer.render(compiled.template(), context))
                .isInstanceOfSatisfying(RenderLimitException.class, e ->
                        assertThat(e.diagnostic().code()).isEqualTo(DiagnosticCodes.OCTL_LOOP_LIMIT));
    }

    // ------------------------------------------------------------------
    // Harness
    // ------------------------------------------------------------------

    /** {@code t0} includes {@code t1} … includes {@code t<levels>}: {@code levels} nested includes below {@code t0}. */
    private void chain(int levels) {
        for (int i = 0; i < levels; i++) {
            template("t" + i, "[t" + i + "]$CMS_INCLUDE(section_template:t" + (i + 1) + ")$");
        }
        template("t" + levels, "[t" + levels + "]");
    }

    private void template(String uid, String source) {
        UUID uuid = uuids.computeIfAbsent(uid, u -> UUID.nameUUIDFromBytes(u.getBytes()));
        sources.put(uuid, source);
    }

    private String renderTopLevel(String uid, JsonNode pageValues) {
        RenderBudget budget = new RenderBudget();
        return renderTemplate(uuids.get(uid), uid, pageValues, budget);
    }

    private String renderTemplate(UUID uuid, String uid, JsonNode pageValues, RenderBudget budget) {
        CompiledTemplate compiled = compiler.compile(
                        sources.get(uuid), "html", (type, ref) -> Optional.ofNullable(uuids.get(ref)))
                .template();
        BlockResolver blocks = new BlockResolver() {
            @Override
            public String renderBody(String bodyName) {
                return "";
            }

            @Override
            public String renderInclude(String includeUid, Map<String, String> args) {
                return renderTemplate(uuids.get(includeUid), includeUid, pageValues, budget);
            }
        };
        RenderContext context = RenderContext.builder()
                .pageValues(pageValues)
                .blockResolver(blocks)
                .budget(budget)
                .build();
        return budget.withTemplate(uuid, uid, () -> renderer.render(compiled, context)).output();
    }
}
