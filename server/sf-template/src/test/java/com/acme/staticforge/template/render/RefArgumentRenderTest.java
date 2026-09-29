package com.acme.staticforge.template.render;

import static org.assertj.core.api.Assertions.assertThat;

import com.acme.staticforge.template.content.ContentDefinition;
import com.acme.staticforge.template.diagnostic.Diagnostic;
import com.acme.staticforge.template.diagnostic.DiagnosticCodes;
import com.acme.staticforge.template.octl.OctlCompiler;
import com.acme.staticforge.template.octl.OctlResult;
import com.acme.staticforge.template.octl.ReferenceResolver;
import com.acme.staticforge.template.octl.ReferenceUse;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.MissingNode;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * {@code $CMS_REF} arguments written without quotes are paths evaluated at render time: {@code locale=l} with a
 * {@code CMS_LOCALES} item, {@code locale=l.code}, any variable or value; a single word that resolves to nothing stays
 * literal text.
 */
class RefArgumentRenderTest {

    private static final ObjectMapper MAPPER = new ObjectMapper();
    private static final UUID ABOUT = UUID.fromString("c0000000-0000-0000-0000-000000000001");
    private static final UUID SITE = UUID.fromString("c0000000-0000-0000-0000-000000000002");
    private static final Map<String, UUID> UUIDS = Map.of("page:about", ABOUT, "global:site", SITE);
    private static final JsonNode LOCALES = json("""
            [{"code":"de","language":"de","label":"Deutsch","current":true,"href":""},
             {"code":"en","language":"en","label":"English","current":false,"href":""}]""");

    private final OctlCompiler compiler = new OctlCompiler();
    private final Renderer renderer = new OctlRenderer();

    @Test
    @DisplayName("locale=l takes a CMS_LOCALES item's code, so one loop links another page in every language")
    void theLanguageItselfIsAnArgument() {
        assertThat(render("$CMS_FOR(l : CMS_LOCALES)$[$CMS_REF(page:about, locale=l)$]$CMS_END_FOR$", "{}"))
                .isEqualTo("[page:about locale=de][page:about locale=en]");
    }

    @Test
    @DisplayName("locale=l.code is a path into the item")
    void aPathIsAnArgument() {
        assertThat(render("$CMS_FOR(l : CMS_LOCALES)$[$CMS_REF(page:about, locale=l.code)$]$CMS_END_FOR$", "{}"))
                .isEqualTo("[page:about locale=de][page:about locale=en]");
    }

    @Test
    @DisplayName("a variable, an editor value and a global value can be arguments too")
    void variablesAndValuesAreArguments() {
        assertThat(render("$CMS_SET(lang = \"en\")$$CMS_REF(page:about, locale=lang)$", "{}"))
                .isEqualTo("page:about locale=en");
        assertThat(render("$CMS_REF(page:about, locale=target)$", "{\"target\":\"en\"}"))
                .isEqualTo("page:about locale=en");
        assertThat(render("$CMS_REF(page:about, locale=CMS_GLOBAL.site.language)$", "{}"))
                .isEqualTo("page:about locale=en");
    }

    @Test
    @DisplayName("quoted values and single words that name nothing stay literal, as before")
    void literalsStayLiteral() {
        assertThat(render("$CMS_REF(page:about, locale=\"en\")$", "{}")).isEqualTo("page:about locale=en");
        assertThat(render("$CMS_REF(page:about, locale=de-CH)$", "{}")).isEqualTo("page:about locale=de-CH");
        assertThat(render("$CMS_REF(page:about, variant=w400)$", "{}")).isEqualTo("page:about variant=w400");
        // A quoted value is literal even when a variable of that name exists.
        assertThat(render("$CMS_SET(en = \"de\")$$CMS_REF(page:about, locale=\"en\")$", "{}"))
                .isEqualTo("page:about locale=en");
    }

    @Test
    @DisplayName("a path that yields nothing, an empty text or a structure leaves the argument out")
    void emptyValuesLeaveTheArgumentOut() {
        assertThat(render("$CMS_FOR(l : CMS_LOCALES)$[$CMS_REF(page:about, locale=l.nope)$]$CMS_END_FOR$", "{}"))
                .isEqualTo("[page:about][page:about]");
        assertThat(render("$CMS_REF(page:about, locale=target)$", "{\"target\":\"\"}")).isEqualTo("page:about");
        assertThat(render("$CMS_REF(page:about, locale=target)$", "{\"target\":[\"de\"]}")).isEqualTo("page:about");
    }

    @Test
    @DisplayName("a dotted argument path is checked like any value; a single word is not (it may be literal)")
    void compileChecks() {
        ContentDefinition noEditors = new ContentDefinition(List.of(), List.of());
        assertThat(codes(compiler.compile("$CMS_REF(page:about, locale=lang.code)$", "html", resolver(), noEditors)))
                .contains(DiagnosticCodes.OCTL_UNKNOWN_EDITOR);
        assertThat(codes(compiler.compile(
                        "$CMS_FOR(l : CMS_LOCALES)$$CMS_REF(page:about, locale=l.code)$$CMS_END_FOR$",
                        "html",
                        resolver(),
                        noEditors)))
                .isEmpty();
        assertThat(codes(compiler.compile("$CMS_REF(page:about, locale=en)$", "html", resolver(), noEditors)))
                .isEmpty();
        assertThat(codes(compiler.compile("$CMS_REF(page:about, locale=CMS_GLOBAL.nope.lang)$", "html", resolver())))
                .contains(DiagnosticCodes.OCTL_UNRESOLVABLE_REF);
    }

    @Test
    @DisplayName("a global read in an argument is a value use of the set, so a change of the set re-renders the page")
    void aGlobalArgumentIsAValueUse() {
        OctlResult compiled = compiler.compile(
                "$CMS_REF(page:about, locale=CMS_GLOBAL.site.language)$", "html", resolver());
        assertThat(compiled.template().referenceUses().get("global:site")).contains(ReferenceUse.VALUE);
        assertThat(compiled.template().referenceUses().get("page:about")).contains(ReferenceUse.REF);
    }

    // ------------------------------------------------------------------

    private String render(String source, String content) {
        OctlResult compiled = compiler.compile(source, "html", resolver());
        assertThat(compiled.hasErrors()).withFailMessage("compile errors: %s", compiled.diagnostics()).isFalse();
        RenderContext context = RenderContext.builder()
                .channel("html")
                .escaping(Escaping.HTML)
                .values(json(content))
                .locales(LOCALES)
                .assetValueResolver((assetType, uuid) ->
                        SITE.equals(uuid) ? json("{\"language\":\"en\"}") : MissingNode.getInstance())
                .urlResolver((kind, uid, uuid, args) -> {
                    StringBuilder out = new StringBuilder(kind + ":" + uid);
                    args.forEach((name, value) -> out.append(' ').append(name).append('=').append(value));
                    return out.toString();
                })
                .build();
        return renderer.render(compiled.template(), context).output();
    }

    private static List<String> codes(OctlResult result) {
        return result.diagnostics().stream().map(Diagnostic::code).toList();
    }

    private static ReferenceResolver resolver() {
        return (type, uid) -> Optional.ofNullable(UUIDS.get(type + ":" + uid));
    }

    private static JsonNode json(String text) {
        try {
            return MAPPER.readTree(text);
        } catch (Exception e) {
            throw new AssertionError("bad test json", e);
        }
    }
}
