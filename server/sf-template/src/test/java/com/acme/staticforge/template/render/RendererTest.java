package com.acme.staticforge.template.render;

import static org.assertj.core.api.Assertions.assertThat;

import com.acme.staticforge.template.diagnostic.Diagnostic;
import com.acme.staticforge.template.diagnostic.DiagnosticCodes;
import com.acme.staticforge.template.octl.OctlCompiler;
import com.acme.staticforge.template.octl.OctlResult;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.Test;

class RendererTest {

    private static final ObjectMapper MAPPER = new ObjectMapper();
    private static final UUID HOME = UUID.fromString("11111111-1111-1111-1111-111111111111");

    private final OctlCompiler compiler = new OctlCompiler();
    private final Renderer renderer = new OctlRenderer();

    // ------------------------------------------------------------------
    // Value rendering + escaping
    // ------------------------------------------------------------------

    @Test
    void valueRendersHtmlEscapedByDefault() {
        String out = render("$CMS_VALUE(headline)$", values("{\"headline\":\"Hello & welcome\"}"));
        assertThat(out).isEqualTo("Hello &amp; welcome");
    }

    @Test
    void scriptInjectedValueIsEscapedUnlessRaw() {
        String evil = "<script>alert('x')</script>";
        String escaped = render("$CMS_VALUE(body)$", values("{\"body\":\"" + evil + "\"}"));
        assertThat(escaped).contains("&lt;script&gt;");
        assertThat(escaped).doesNotContain("<script>");

        String raw = render("$CMS_VALUE(body | raw)$", values("{\"body\":\"" + evil + "\"}"));
        assertThat(raw).contains("<script>");
    }

    @Test
    void catalogValueRendersCardsViaBlockResolver() {
        OctlResult compiled = compiler.compile("$CMS_VALUE(related)$", "html", null);
        assertThat(compiled.hasErrors()).isFalse();

        String cardsJson =
                "\"cards\":["
                        + "{\"instanceId\":\"a\",\"templateRef\":\"" + HOME + "\",\"content\":{\"title\":\"One\"}},"
                        + "{\"instanceId\":\"b\",\"templateRef\":\"" + HOME + "\",\"content\":{\"title\":\"Two\"}}"
                        + "]";
        List<JsonNode> seen = new java.util.ArrayList<>();
        BlockResolver resolver = new BlockResolver() {
            @Override
            public String renderBody(String bodyName) {
                return "";
            }

            @Override
            public String renderInclude(String uid, java.util.Map<String, String> args) {
                return "";
            }

            @Override
            public String renderNav(String structureUid, java.util.Map<String, String> args) {
                return "";
            }

            @Override
            public String renderCatalog(JsonNode cards) {
                seen.add(cards);
                return "<cards:" + cards.size() + ">";
            }
        };

        RenderContext context = RenderContext.builder()
                .values(values("{\"related\":{\"type\":\"CATALOG\"," + cardsJson + "}}"))
                .blockResolver(resolver)
                .build();
        RenderResult result = renderer.render(compiled.template(), context);

        assertThat(result.output()).isEqualTo("<cards:2>");
        assertThat(seen).hasSize(1);
        assertThat(seen.get(0).path(0).path("templateRef").asText()).isEqualTo(HOME.toString());
        assertThat(result.dependencies()).containsExactly(HOME);
    }

    // ------------------------------------------------------------------
    // Filters
    // ------------------------------------------------------------------

    @Test
    void upperFilter() {
        assertThat(render("$CMS_VALUE(headline | upper)$", values("{\"headline\":\"hello\"}")))
                .isEqualTo("HELLO");
    }

    @Test
    void truncateFilter() {
        assertThat(render("$CMS_VALUE(headline | truncate(5))$", values("{\"headline\":\"hello world\"}")))
                .isEqualTo("hello");
    }

    @Test
    void defaultFilterOnMissingValue() {
        assertThat(render("$CMS_VALUE(missing | default(\"fallback\"))$", values("{}")))
                .isEqualTo("fallback");
    }

    @Test
    void chainedFilters() {
        assertThat(render("$CMS_VALUE(headline | trim | lower)$", values("{\"headline\":\"  Hello \"}")))
                .isEqualTo("hello");
    }

    // ------------------------------------------------------------------
    // Control flow
    // ------------------------------------------------------------------

    @Test
    void ifElseBranches() {
        String template = "$CMS_IF(show)$yes$CMS_ELSE$no$CMS_END_IF$";
        assertThat(render(template, values("{\"show\":true}"))).isEqualTo("yes");
        assertThat(render(template, values("{\"show\":false}"))).isEqualTo("no");
    }

    @Test
    void forLoopWithIndexAndFirst() {
        String template =
                "$CMS_FOR(item : items)$<$CMS_VALUE(item._index)$:$CMS_VALUE(item.name)$:$CMS_IF(item._first)$first$CMS_ELSE$rest$CMS_END_IF$>$CMS_END_FOR$";
        String out = render(template, values("{\"items\":[{\"name\":\"a\"},{\"name\":\"b\"}]}"));
        assertThat(out).isEqualTo("<0:a:first><1:b:rest>");
    }

    @Test
    void doubleDollarAndForeignDelimitersPassThrough() {
        assertThat(render("price: $$5 and {{ x }} and ${y}", values("{}")))
                .isEqualTo("price: $5 and {{ x }} and ${y}");
    }

    @Test
    void setThenValue() {
        assertThat(render("$CMS_SET(name = \"world\")$hello $CMS_VALUE(name)$", values("{}")))
                .isEqualTo("hello world");
    }

    // ------------------------------------------------------------------
    // References
    // ------------------------------------------------------------------

    @Test
    void refResolvedViaUrlResolver() {
        OctlResult compiled =
                compiler.compile("$CMS_REF(page:home)$", "html", (assetType, uid) -> Optional.of(HOME));
        assertThat(compiled.hasErrors()).isFalse();

        RenderContext context = RenderContext.builder()
                .urlResolver((kind, uid, uuid, args) -> "/" + kind + "/" + uid + "/")
                .build();
        RenderResult result = renderer.render(compiled.template(), context);

        assertThat(result.output()).isEqualTo("/page/home/");
        assertThat(result.dependencies()).containsExactly(HOME);
    }

    // ------------------------------------------------------------------
    // md / plain
    // ------------------------------------------------------------------

    @Test
    void mdAndPlainRoundTrip() {
        RenderContext markdown = RenderContext.builder()
                .channel("markdown")
                .escaping(Escaping.MARKDOWN)
                .values(values("{\"x\":\"# Hello\"}"))
                .build();

        assertThat(render("$CMS_VALUE(x | md)$", markdown)).isEqualTo("<h1>Hello</h1>");
        assertThat(render(
                        "$CMS_VALUE(x | plain)$",
                        RenderContext.builder().values(values("{\"x\":\"<h1>Hello</h1>\"}")).build()))
                .isEqualTo("Hello");
    }

    // ------------------------------------------------------------------
    // Diagnostics
    // ------------------------------------------------------------------

    @Test
    void unbalancedIfReports0102() {
        OctlResult result = compiler.compile("$CMS_IF(x)$foo", "html", null);
        assertThat(codes(result.diagnostics())).contains(DiagnosticCodes.OCTL_UNBALANCED_BLOCK);
    }

    @Test
    void unknownFilterReports0104() {
        OctlResult result = compiler.compile("$CMS_VALUE(x | bogus)$", "html", null);
        assertThat(codes(result.diagnostics())).contains(DiagnosticCodes.OCTL_UNKNOWN_FILTER);
    }

    @Test
    void unresolvableRefReports0110() {
        OctlResult result = compiler.compile("$CMS_REF(page:nope)$", "html", (assetType, uid) -> Optional.empty());
        assertThat(codes(result.diagnostics())).contains(DiagnosticCodes.OCTL_UNRESOLVABLE_REF);
    }

    // ------------------------------------------------------------------
    // Navigation recursion
    // ------------------------------------------------------------------

    @Test
    void navRecurseDelegatesResolvedLoopItemToBlockResolver() {
        OctlResult compiled = compiler.compile(
                "$CMS_FOR(node : nodes)$[$CMS_NAV_RECURSE(node)$]$CMS_END_FOR$", "html", null);
        assertThat(compiled.hasErrors()).isFalse();

        List<JsonNode> seen = new java.util.ArrayList<>();
        BlockResolver resolver = new BlockResolver() {
            @Override
            public String renderBody(String bodyName) {
                return "";
            }

            @Override
            public String renderInclude(String uid, java.util.Map<String, String> args) {
                return "";
            }

            @Override
            public String renderNav(String structureUid, java.util.Map<String, String> args) {
                return "";
            }

            @Override
            public String renderNavRecurse(JsonNode node) {
                seen.add(node);
                return "child:" + node.path("level").asInt();
            }
        };

        RenderContext context = RenderContext.builder()
                .values(values("{\"nodes\":[{\"children\":[],\"level\":1},{\"children\":[],\"level\":2}]}"))
                .blockResolver(resolver)
                .build();
        String out = renderer.render(compiled.template(), context).output();

        assertThat(out).isEqualTo("[child:1][child:2]");
        assertThat(seen).hasSize(2);
        assertThat(seen.get(0).path("level").asInt()).isEqualTo(1);
        assertThat(seen.get(1).path("level").asInt()).isEqualTo(2);
    }

    // ------------------------------------------------------------------
    // Helpers
    // ------------------------------------------------------------------

    private String render(String source, JsonNode values) {
        return render(source, RenderContext.builder().values(values).build());
    }

    private String render(String source, RenderContext context) {
        OctlResult compiled = compiler.compile(source, "html", null);
        assertThat(compiled.hasErrors())
                .withFailMessage("compile errors: %s", compiled.diagnostics())
                .isFalse();
        return renderer.render(compiled.template(), context).output();
    }

    private static JsonNode values(String json) {
        try {
            return MAPPER.readTree(json);
        } catch (Exception e) {
            throw new AssertionError("bad test json", e);
        }
    }

    private static List<String> codes(List<Diagnostic> diagnostics) {
        return diagnostics.stream().map(Diagnostic::code).toList();
    }
}
