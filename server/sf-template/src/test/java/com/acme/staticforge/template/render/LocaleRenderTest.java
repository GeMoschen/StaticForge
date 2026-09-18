package com.acme.staticforge.template.render;

import static org.assertj.core.api.Assertions.assertThat;

import com.acme.staticforge.template.octl.OctlCompiler;
import com.acme.staticforge.template.octl.OctlResult;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.TextNode;
import java.util.List;
import java.util.Locale;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/** Language-dependent value resolution and locale-aware filters in the renderer (M24.3.1). */
class LocaleRenderTest {

    private static final ObjectMapper MAPPER = new ObjectMapper();

    private final OctlCompiler compiler = new OctlCompiler();
    private final Renderer renderer = new OctlRenderer();
    private final Locale jvmDefault = Locale.getDefault();

    @AfterEach
    void restoreJvmDefault() {
        Locale.setDefault(jvmDefault);
    }

    private static JsonNode json(String raw) {
        try {
            return MAPPER.readTree(raw);
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }

    private String render(String octl, String content, String locale, List<String> chain) {
        OctlResult compiled = compiler.compile(octl, "html", null, null);
        assertThat(compiled.diagnostics()).isEmpty();
        RenderContext context = RenderContext.builder()
                .channel("html")
                .escaping(Escaping.HTML)
                .values(json(content))
                .locale(locale, chain)
                .build();
        return renderer.render(compiled.template(), context).output();
    }

    @Test
    @DisplayName("a wrapper resolves through the chain, and an unresolvable one is falsy")
    void resolvesThroughChain() {
        String content =
                """
                {"street":{"type":"L10N","values":{"de":"Strasse","en":"Street"}},
                 "only":{"type":"L10N","values":{"en":"Street"}},
                 "none":{"type":"L10N","values":{}}}""";

        assertThat(render("$CMS_VALUE(street)$", content, "de-CH", List.of("de-CH", "de", "en")))
                .isEqualTo("Strasse");
        assertThat(render("$CMS_VALUE(only)$", content, "de-CH", List.of("de-CH", "de", "en")))
                .isEqualTo("Street");
        assertThat(render("$CMS_VALUE(none)$", content, "de", List.of("de")))
                .isEmpty();
        assertThat(render("$CMS_IF(none)$yes$CMS_ELSE$no$CMS_END_IF$", content, "de", List.of("de")))
                .isEqualTo("no");
    }

    @Test
    @DisplayName("the value is resolved once, so filters and | json never see the wrapper")
    void filtersSeeTheResolvedValue() {
        String content = "{\"headline\":{\"type\":\"L10N\",\"values\":{\"de\":\"Die Parka\"}}}";

        assertThat(render("$CMS_VALUE(headline | upper)$", content, "de", List.of("de"))).isEqualTo("DIE PARKA");
        assertThat(render("$CMS_VALUE(headline | size)$", content, "de", List.of("de"))).isEqualTo("9");
    }

    @Test
    @DisplayName("| json on a whole object emits resolved values, not wrappers")
    void jsonFilterResolvesNestedWrappers() {
        String content =
                """
                {"meta":{"title":{"type":"L10N","values":{"de":"Titel","en":"Title"}},"sku":"A-1"}}""";

        String output = render("$CMS_VALUE(meta | json | raw)$", content, "en", List.of("en"));

        assertThat(output).doesNotContain("L10N");
        assertThat(output).contains("\"title\":\"Title\"").contains("\"sku\":\"A-1\"");
    }

    @Test
    @DisplayName("a path walks through a wrapper into the value it holds")
    void pathWalksThroughAWrapper() {
        String content =
                """
                {"hero":{"type":"L10N","values":{"de":{"altText":"Ein Foto"},"en":{"altText":"A photo"}}}}""";

        assertThat(render("$CMS_VALUE(hero.altText)$", content, "en", List.of("en", "de"))).isEqualTo("A photo");
        assertThat(render("$CMS_VALUE(hero.altText)$", content, "de", List.of("de", "en"))).isEqualTo("Ein Foto");
    }

    @Test
    @DisplayName("date and number format in the render language, whatever the JVM default is")
    void filtersAreLocaleAwareAndJvmIndependent() {
        Locale.setDefault(Locale.forLanguageTag("th-TH"));
        String content = "{\"when\":\"2026-10-03T00:00:00Z\",\"price\":1234.5}";

        assertThat(render("$CMS_VALUE(when | date(\"d. MMMM yyyy\"))$", content, "de", List.of("de")))
                .isEqualTo("3. Oktober 2026");
        assertThat(render("$CMS_VALUE(when | date(\"d. MMMM yyyy\"))$", content, "en", List.of("en")))
                .isEqualTo("3. October 2026");
        assertThat(render("$CMS_VALUE(price | number(\"#,##0.00\"))$", content, "de", List.of("de")))
                .isEqualTo("1.234,50");
        assertThat(render("$CMS_VALUE(price | number(\"#,##0.00\"))$", content, "en", List.of("en")))
                .isEqualTo("1,234.50");
    }

    @Test
    @DisplayName("without a render language the filters stay language-neutral, never the JVM default")
    void withoutLocaleFiltersAreNeutral() {
        Locale.setDefault(Locale.GERMANY);
        String content = "{\"when\":\"2026-10-03T00:00:00Z\",\"price\":1234.5}";

        // Locale.ROOT abbreviates month names, so `MMMM` is "Oct", not "October". That is a
        // deliberate M24.3.1 change: `date` used to format with the JVM default, so the same
        // template produced "Oktober" on a German machine and "October" on an English one.
        // Templates that want a spelled-out month in a project without languages pass the
        // language explicitly: date("d. MMMM yyyy", "en").
        assertThat(render("$CMS_VALUE(when | date(\"d. MMMM yyyy\"))$", content, null, List.of()))
                .isEqualTo("3. Oct 2026");
        assertThat(render("$CMS_VALUE(when | date(\"d. MMMM yyyy\", \"en\"))$", content, null, List.of()))
                .isEqualTo("3. October 2026");
        assertThat(render("$CMS_VALUE(price | number(\"#,##0.00\"))$", content, null, List.of()))
                .isEqualTo("1,234.50");
    }

    @Test
    @DisplayName("a project without locales renders a bare value exactly as before")
    void nonLocalizedProjectIsUnchanged() {
        assertThat(render("$CMS_VALUE(headline)$", "{\"headline\":\"Plain\"}", null, List.of()))
                .isEqualTo("Plain");
    }

    @Test
    @DisplayName("CMS_LOCALES drives a language switcher")
    void localesLoop() {
        OctlResult compiled = compiler.compile(
                "$CMS_FOR(l : CMS_LOCALES)$[$CMS_VALUE(l.code)$:$CMS_IF(l.current)$on$CMS_ELSE$off$CMS_END_IF$]$CMS_END_FOR$",
                "html",
                null,
                null);
        assertThat(compiled.diagnostics()).isEmpty();

        com.fasterxml.jackson.databind.node.ArrayNode locales =
                com.fasterxml.jackson.databind.node.JsonNodeFactory.instance.arrayNode();
        locales.addObject().put("code", "de").put("current", true);
        locales.addObject().put("code", "en").put("current", false);

        RenderContext context = RenderContext.builder()
                .channel("html")
                .escaping(Escaping.HTML)
                .locale("de", List.of("de"))
                .locales(locales)
                .build();

        assertThat(renderer.render(compiled.template(), context).output()).isEqualTo("[de:on][en:off]");
    }

    @Test
    @DisplayName("CMS_LOCALES renders nothing when the project has no locales")
    void localesLoopEmptyWithoutLocales() {
        OctlResult compiled = compiler.compile("$CMS_FOR(l : CMS_LOCALES)$x$CMS_END_FOR$", "html", null, null);
        assertThat(compiled.diagnostics()).isEmpty();

        RenderContext context = RenderContext.builder().channel("html").escaping(Escaping.HTML).build();

        assertThat(renderer.render(compiled.template(), context).output()).isEmpty();
    }

    @Test
    @DisplayName("$CMS_META(locale|language)$ report the render language")
    void metaKeys() {
        OctlResult compiled = compiler.compile("$CMS_META(locale)$/$CMS_META(language)$", "html", null, null);
        RenderContext context = RenderContext.builder()
                .channel("html")
                .escaping(Escaping.HTML)
                .meta("locale", TextNode.valueOf("de-CH"))
                .meta("language", TextNode.valueOf("de"))
                .build();

        assertThat(renderer.render(compiled.template(), context).output()).isEqualTo("de-CH/de");
    }
}
