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

/** `M16.2.1`: cross-asset values ({@code assetType:uid.path}) through {@link AssetValueResolver}. */
class CrossAssetValueRenderTest {

    private static final ObjectMapper MAPPER = new ObjectMapper();
    private static final UUID ABOUT = UUID.fromString("a0000000-0000-0000-0000-000000000001");
    private static final UUID GONE = UUID.fromString("a0000000-0000-0000-0000-000000000002");
    private static final Map<String, UUID> UUIDS = Map.of("page:about", ABOUT, "page:gone", GONE);

    private static final JsonNode ABOUT_VALUES = json(
            "{\"headline\":\"About us\",\"flag\":true,\"off\":false,"
                    + "\"hero\":{\"caption\":{\"text\":\"Deep\"}},"
                    + "\"links\":[{\"label\":\"One\"},{\"label\":\"Two\"},{\"label\":\"Three\"}]}");

    private final OctlCompiler compiler = new OctlCompiler();
    private final Renderer renderer = new OctlRenderer();

    /** Records every lookup; {@code about} resolves, {@code gone} is a missing/deleted asset. */
    private final List<String> lookups = new ArrayList<>();
    private final AssetValueResolver stub = (assetType, uuid) -> {
        lookups.add(assetType + ":" + uuid);
        return ABOUT.equals(uuid) ? ABOUT_VALUES : MissingNode.getInstance();
    };

    @Test
    void scalarEditorValue() {
        RenderResult result = render("$CMS_VALUE(page:about.headline)$", stub);
        assertThat(result.output()).isEqualTo("About us");
        assertThat(result.dependencies()).containsExactly(ABOUT);
        assertThat(lookups).containsExactly("page:" + ABOUT);
    }

    @Test
    void nestedPath() {
        assertThat(render("$CMS_VALUE(page:about.hero.caption.text)$", stub).output()).isEqualTo("Deep");
    }

    @Test
    void listIterationWithLoopMetadata() {
        RenderResult result = render(
                "$CMS_FOR(link : page:about.links)$$CMS_VALUE(link._index)$=$CMS_VALUE(link.label)$"
                        + "$CMS_IF(link._last)$.$CMS_ELSE$,$CMS_END_IF$$CMS_END_FOR$",
                stub);
        assertThat(result.output()).isEqualTo("0=One,1=Two,2=Three.");
        assertThat(result.dependencies()).containsExactly(ABOUT);
    }

    @Test
    void conditionOnCrossAssetFlag() {
        assertThat(render("$CMS_IF(page:about.flag)$yes$CMS_ELSE$no$CMS_END_IF$", stub).output()).isEqualTo("yes");
        assertThat(render("$CMS_IF(page:about.off)$yes$CMS_ELSE$no$CMS_END_IF$", stub).output()).isEqualTo("no");
    }

    @Test
    void setFromCrossAssetValue() {
        assertThat(render("$CMS_SET(h = page:about.headline)$[$CMS_VALUE(h)$]", stub).output()).isEqualTo("[About us]");
    }

    @Test
    void filtersApplyToCrossAssetValue() {
        assertThat(render("$CMS_VALUE(page:about.headline | upper)$", stub).output()).isEqualTo("ABOUT US");
    }

    @Test
    void crossAssetValueIsEscapedByChannelDefault() {
        AssetValueResolver evil = (assetType, uuid) -> json("{\"body\":\"<script>x</script>\"}");
        assertThat(render("$CMS_VALUE(page:about.body)$", evil).output()).isEqualTo("&lt;script&gt;x&lt;/script&gt;");
        assertThat(render("$CMS_VALUE(page:about.body | raw)$", evil).output()).isEqualTo("<script>x</script>");
    }

    @Test
    void missingAssetRendersEmptyWithOneWarningAndKeepsDependency() {
        RenderResult result = render(
                "[$CMS_VALUE(page:gone.headline)$|$CMS_IF(page:gone.flag)$y$CMS_ELSE$n$CMS_END_IF$"
                        + "|$CMS_FOR(l : page:gone.links)$x$CMS_END_FOR$]",
                stub);
        assertThat(result.output()).isEqualTo("[|n|]");
        assertThat(result.dependencies()).containsExactly(GONE);
        assertThat(result.warnings()).singleElement().satisfies(w -> {
            assertThat(w.code()).isEqualTo(DiagnosticCodes.OCTL_MISSING_VALUE_TARGET);
            assertThat(w.severity()).isEqualTo(Severity.WARNING);
            assertThat(w.message()).contains("page:gone");
        });
    }

    @Test
    void unknownEditorOnExistingAssetRendersEmptyWithoutWarning() {
        RenderResult result = render("[$CMS_VALUE(page:about.nope.deeper)$]", stub);
        assertThat(result.output()).isEqualTo("[]");
        assertThat(result.warnings()).isEmpty();
    }

    @Test
    void resolverReturningNullIsTreatedAsMissing() {
        RenderResult result = render("[$CMS_VALUE(page:about.headline)$]", (assetType, uuid) -> null);
        assertThat(result.output()).isEqualTo("[]");
        assertThat(result.dependencies()).containsExactly(ABOUT);
        assertThat(result.warnings()).extracting(Diagnostic::code).containsExactly(DiagnosticCodes.OCTL_MISSING_VALUE_TARGET);
    }

    @Test
    void withoutResolverRendersEmptyAndRecordsDependency() {
        RenderResult result = render(
                "[$CMS_VALUE(page:about.headline)$|$CMS_IF(page:about.flag)$y$CMS_ELSE$n$CMS_END_IF$"
                        + "|$CMS_FOR(l : page:about.links)$x$CMS_END_FOR$]",
                null);
        assertThat(result.output()).isEqualTo("[|n|]");
        assertThat(result.dependencies()).containsExactly(ABOUT);
        assertThat(result.warnings()).isEmpty();
    }

    @Test
    void pathLessCrossAssetValueWarns0111() {
        OctlResult compiled = compiler.compile("$CMS_VALUE(page:about)$", "html", (type, uid) -> Optional.of(ABOUT));
        assertThat(compiled.hasErrors()).isFalse();
        assertThat(compiled.diagnostics())
                .filteredOn(d -> DiagnosticCodes.OCTL_CROSS_ASSET_VALUE_WITHOUT_PATH.equals(d.code()))
                .singleElement()
                .extracting(Diagnostic::severity)
                .isEqualTo(Severity.WARNING);
    }

    @Test
    void crossAssetValueWithPathAndRefWithoutPathDoNotWarn() {
        OctlResult compiled = compiler.compile(
                "$CMS_VALUE(page:about.headline)$$CMS_REF(page:about)$", "html", (type, uid) -> Optional.of(ABOUT));
        assertThat(compiled.diagnostics()).extracting(Diagnostic::code)
                .doesNotContain(DiagnosticCodes.OCTL_CROSS_ASSET_VALUE_WITHOUT_PATH);
    }

    private RenderResult render(String source, AssetValueResolver resolver) {
        OctlResult compiled = compiler.compile(source, "html", (type, uid) -> Optional.ofNullable(UUIDS.get(type + ":" + uid)));
        assertThat(compiled.hasErrors()).withFailMessage("compile errors: %s", compiled.diagnostics()).isFalse();
        return renderer.render(compiled.template(), RenderContext.builder().assetValueResolver(resolver).build());
    }

    private static JsonNode json(String text) {
        try {
            return MAPPER.readTree(text);
        } catch (Exception e) {
            throw new AssertionError("bad test json", e);
        }
    }
}
