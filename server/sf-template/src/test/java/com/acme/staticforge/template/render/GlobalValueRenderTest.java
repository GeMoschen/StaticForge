package com.acme.staticforge.template.render;

import static org.assertj.core.api.Assertions.assertThat;

import com.acme.staticforge.template.diagnostic.Diagnostic;
import com.acme.staticforge.template.diagnostic.DiagnosticCodes;
import com.acme.staticforge.template.diagnostic.Severity;
import com.acme.staticforge.template.octl.OctlCompiler;
import com.acme.staticforge.template.octl.OctlResult;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.MissingNode;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.Test;

/**
 * {@code M17.3.1}: global property sets in OCTL. The point of these tests is that
 * {@code CMS_GLOBAL.site.title} and {@code global:site.title} are the <em>same</em> thing — the
 * parser desugars the first into the second, so there is one resolution path, one reference edge
 * and one dependency, and the two spellings cannot drift apart.
 */
class GlobalValueRenderTest {

    private static final ObjectMapper MAPPER = new ObjectMapper();
    private static final UUID SITE = UUID.fromString("b0000000-0000-0000-0000-000000000001");
    private static final UUID GONE = UUID.fromString("b0000000-0000-0000-0000-000000000002");
    private static final UUID LOGO = UUID.fromString("b0000000-0000-0000-0000-00000000000a");
    private static final Map<String, UUID> UUIDS = Map.of("global:site", SITE, "global:gone", GONE);

    private static final JsonNode SITE_VALUES = json("{\"title\":\"Acme Outdoor\",\"showBanner\":true,"
            + "\"logo\":{\"type\":\"MEDIA_REF\",\"uuid\":\"b0000000-0000-0000-0000-00000000000a\"},"
            + "\"links\":[{\"label\":\"Mastodon\"},{\"label\":\"Bluesky\"}],"
            + "\"_meta\":{\"uid\":\"site\",\"displayName\":\"Site\"}}");

    private final OctlCompiler compiler = new OctlCompiler();
    private final Renderer renderer = new OctlRenderer();

    private final List<String> lookups = new ArrayList<>();
    private final AssetValueResolver values = (assetType, uuid) -> {
        lookups.add(assetType + ":" + uuid);
        return SITE.equals(uuid) ? SITE_VALUES : MissingNode.getInstance();
    };

    @Test
    void bothSpellingsRenderTheSameValueThroughOneLookupPath() {
        assertThat(render("$CMS_VALUE(global:site.title)$").output()).isEqualTo("Acme Outdoor");
        assertThat(render("$CMS_VALUE(CMS_GLOBAL.site.title)$").output()).isEqualTo("Acme Outdoor");
        assertThat(lookups).containsExactly("global:" + SITE, "global:" + SITE);
    }

    @Test
    void shorthandRecordsTheSetAsADependency() {
        assertThat(render("$CMS_VALUE(CMS_GLOBAL.site.title)$").dependencies()).containsExactly(SITE);
    }

    @Test
    void shorthandCompilesToTheSameReferenceKeyAsTheExplicitForm() {
        assertThat(compile("$CMS_VALUE(CMS_GLOBAL.site.title)$").template().references())
                .containsExactly(Map.entry("global:site", SITE));
    }

    @Test
    void conditionsFiltersAndLoopsWorkOnSetValues() {
        assertThat(render("$CMS_IF(CMS_GLOBAL.site.showBanner)$on$CMS_ELSE$off$CMS_END_IF$").output())
                .isEqualTo("on");
        assertThat(render("$CMS_VALUE(CMS_GLOBAL.site.title | upper)$").output()).isEqualTo("ACME OUTDOOR");
        assertThat(render("$CMS_FOR(l : CMS_GLOBAL.site.links)$[$CMS_VALUE(l.label)$]$CMS_END_FOR$").output())
                .isEqualTo("[Mastodon][Bluesky]");
        assertThat(render("$CMS_SET(t = CMS_GLOBAL.site.title)$<$CMS_VALUE(t)$>").output())
                .isEqualTo("<Acme Outdoor>");
    }

    @Test
    void reservedMetaIsReadableLikeAnyOtherCrossAssetTarget() {
        assertThat(render("$CMS_VALUE(CMS_GLOBAL.site._meta.displayName)$").output()).isEqualTo("Site");
    }

    /**
     * The media a set's editor points at is refed through the <em>value</em>, and the media — not
     * the set — becomes the render dependency that makes generation copy the file.
     */
    @Test
    void refOnAMediaEditorInsideASetResolvesTheMediaUrl() {
        RenderResult result = render("$CMS_REF(CMS_GLOBAL.site.logo)$");
        assertThat(result.output()).isEqualTo("media:" + LOGO);
        assertThat(result.dependencies()).contains(SITE, LOGO);
    }

    /** The same fix applies to every prefix; before M17.3.1 this silently linked the page. */
    @Test
    void refOnAnEditorOfAnyCrossAssetTargetResolvesThatEditorsValue() {
        assertThat(render("$CMS_REF(global:site.logo)$").output()).isEqualTo("media:" + LOGO);
    }

    @Test
    void refWithoutAValuePathIsACompileError() {
        assertThat(errorCodes("$CMS_REF(CMS_GLOBAL.site)$"))
                .contains(DiagnosticCodes.OCTL_GLOBAL_REFERENCE_MISUSE);
        assertThat(errorCodes("$CMS_REF(global:site)$"))
                .contains(DiagnosticCodes.OCTL_GLOBAL_REFERENCE_MISUSE);
    }

    @Test
    void bareGlobalRootWithoutASetIsACompileError() {
        OctlResult compiled = compiler.compile(
                "$CMS_VALUE(CMS_GLOBAL)$", "html", resolver(), new com.acme.staticforge.template.content.ContentDefinition(List.of(), List.of()));
        assertThat(compiled.diagnostics())
                .filteredOn(d -> d.severity() == Severity.ERROR)
                .extracting(Diagnostic::code)
                .containsExactly(DiagnosticCodes.OCTL_GLOBAL_REFERENCE_MISUSE);
    }

    /** {@code CMS_GLOBAL} must never be mistaken for a local editor name (compare {@code CMS_PAGE}). */
    @Test
    void shorthandIsNotFlaggedAsAnUnknownEditor() {
        OctlResult compiled = compiler.compile(
                "$CMS_VALUE(CMS_GLOBAL.site.title)$",
                "html",
                resolver(),
                new com.acme.staticforge.template.content.ContentDefinition(List.of(), List.of()));
        assertThat(compiled.diagnostics()).extracting(Diagnostic::code)
                .doesNotContain(DiagnosticCodes.OCTL_UNKNOWN_EDITOR);
    }

    @Test
    void unknownSetIsUnresolvableInBothSpellings() {
        assertThat(errorCodes("$CMS_VALUE(CMS_GLOBAL.nope.title)$"))
                .contains(DiagnosticCodes.OCTL_UNRESOLVABLE_REF);
        assertThat(errorCodes("$CMS_VALUE(global:nope.title)$"))
                .contains(DiagnosticCodes.OCTL_UNRESOLVABLE_REF);
    }

    @Test
    void deletedSetRendersEmptyWithTheStandardWarning() {
        RenderResult result = render("[$CMS_VALUE(CMS_GLOBAL.gone.title)$]");
        assertThat(result.output()).isEqualTo("[]");
        assertThat(result.warnings()).extracting(Diagnostic::code)
                .containsExactly(DiagnosticCodes.OCTL_MISSING_VALUE_TARGET);
    }

    // ------------------------------------------------------------------

    private RenderResult render(String source) {
        OctlResult compiled = compile(source);
        return renderer.render(
                compiled.template(),
                RenderContext.builder()
                        .assetValueResolver(values)
                        .urlResolver((kind, uid, uuid, args) -> kind + ":" + uuid)
                        .build());
    }

    private OctlResult compile(String source) {
        OctlResult compiled = compiler.compile(source, "html", resolver());
        assertThat(compiled.hasErrors()).withFailMessage("compile errors: %s", compiled.diagnostics()).isFalse();
        return compiled;
    }

    private List<String> errorCodes(String source) {
        return compiler.compile(source, "html", resolver()).diagnostics().stream()
                .filter(d -> d.severity() == Severity.ERROR)
                .map(Diagnostic::code)
                .toList();
    }

    private static com.acme.staticforge.template.octl.ReferenceResolver resolver() {
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
