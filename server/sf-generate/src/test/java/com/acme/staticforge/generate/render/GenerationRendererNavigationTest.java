package com.acme.staticforge.generate.render;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.acme.staticforge.asset.AssetType;
import com.acme.staticforge.asset.navigation.NavigationDiagnosticCodes;
import com.acme.staticforge.generate.plan.PlanEntry;
import com.acme.staticforge.generate.pipeline.RenderedFile;
import com.acme.staticforge.generate.snapshot.Snapshot;
import com.acme.staticforge.generate.snapshot.SnapshotAsset;
import com.acme.staticforge.revision.RevisionContext;
import com.acme.staticforge.template.diagnostic.Diagnostic;
import com.acme.staticforge.template.render.RenderLimitException;
import com.acme.staticforge.urlregistry.ResetScope;
import com.acme.staticforge.urlregistry.UrlArea;
import com.acme.staticforge.urlregistry.UrlRegistryEntry;
import com.acme.staticforge.urlregistry.UrlRegistryService;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.Test;

/**
 * End-to-end {@code $CMS_NAVIGATION}/{@code BlockResolver#renderNavigation} coverage through
 * {@link GenerationRenderer} against a real (in-memory) {@link Snapshot} — the snapshot-backed
 * half of `M8.1.4`'s render wiring. Complements {@code NavigationHtmlGoldenTest} (sf-domain,
 * which golden-tests {@code NavigationTreeJson}/{@code NavigationHtmlRenderer} directly, without
 * a page/template/{@code NavigationService} pipeline around them) by proving the OCTL instruction
 * actually resolves the reference, calls {@code NavigationService.tree} via
 * {@code SnapshotNavigationLookup}, and produces the right href/active/trail markup for the page
 * being rendered — plus that a {@code startNode} cycle surfaces {@code SF-GEN-0410} into the
 * rendered file's diagnostics.
 */
class GenerationRendererNavigationTest {

    private static final ObjectMapper MAPPER = new ObjectMapper();

    private static final UUID NAV_ROOT = UUID.fromString("00000000-0000-0000-0000-000000000001");
    private static final UUID HOME_REF = UUID.fromString("00000000-0000-0000-0000-000000000002");
    private static final UUID ABOUT_REF = UUID.fromString("00000000-0000-0000-0000-000000000003");
    private static final UUID PRODUCTS_FOLDER = UUID.fromString("00000000-0000-0000-0000-000000000010");
    private static final UUID WIDGET_REF = UUID.fromString("00000000-0000-0000-0000-000000000011");

    private static final UUID PAGE_TEMPLATE = UUID.fromString("00000000-0000-0000-0000-000000000100");
    private static final UUID HOME_PAGE = UUID.fromString("00000000-0000-0000-0000-000000000101");
    private static final UUID ABOUT_PAGE = UUID.fromString("00000000-0000-0000-0000-000000000102");
    private static final UUID WIDGET_PAGE = UUID.fromString("00000000-0000-0000-0000-000000000103");

    private static final UUID CYCLIC_TEMPLATE = UUID.fromString("00000000-0000-0000-0000-000000000200");
    private static final UUID CYCLIC_NAV_ROOT = UUID.fromString("00000000-0000-0000-0000-000000000201");
    private static final UUID CYCLIC_PAGE = UUID.fromString("00000000-0000-0000-0000-000000000202");

    @Test
    void flatFolderRendersLinksWithActiveMarking() {
        SnapshotAsset template = pageTemplate(PAGE_TEMPLATE, "$CMS_NAVIGATION(nav:main)$");
        SnapshotAsset navRoot = folder(NAV_ROOT, "main", "/nav/", "{\"scope\":\"NAVIGATION\"}");
        SnapshotAsset homeRef = pageReference(HOME_REF, "home-ref", "/nav/", HOME_PAGE, "Home");
        SnapshotAsset aboutRef = pageReference(ABOUT_REF, "about-ref", "/nav/", ABOUT_PAGE, "About Us");
        SnapshotAsset homePage = page(HOME_PAGE, "home", "/", PAGE_TEMPLATE);
        SnapshotAsset aboutPage = page(ABOUT_PAGE, "about", "/", PAGE_TEMPLATE);

        Snapshot snapshot = snapshot(template, navRoot, homeRef, aboutRef, homePage, aboutPage);
        GenerationRenderer renderer = new GenerationRenderer(
                snapshot, OutputPathResolver.forSnapshot(snapshot, "index", false, "RELATIVE"), "proj", null);

        RenderedFile file = renderer.render(new PlanEntry(HOME_PAGE, "html", "home.html"));
        String html = new String(file.bytes(), java.nio.charset.StandardCharsets.UTF_8);

        // NavigationServiceImpl orders FOLDER/PAGE_REFERENCE siblings by displayName then uid
        // ("about-ref" < "home-ref").
        assertThat(html).isEqualTo(
                "<ul class=\"nav\">"
                        + "<li class=\"nav-item\"><a href=\"about.html\">About Us</a></li>"
                        + "<li class=\"nav-item active\"><a href=\"home.html\">Home</a></li>"
                        + "</ul>");
        assertThat(file.dependencies()).contains(NAV_ROOT);
    }

    @Test
    void nestedGroupingFolderWithNoStartNodeRendersAsNonLinkedGrouping() {
        SnapshotAsset template = pageTemplate(PAGE_TEMPLATE, "$CMS_NAVIGATION(nav:main)$");
        SnapshotAsset navRoot = folder(NAV_ROOT, "main", "/nav/", "{\"scope\":\"NAVIGATION\"}");
        SnapshotAsset products = folder(PRODUCTS_FOLDER, "products", "/nav/products/", "{\"scope\":\"NAVIGATION\"}");
        SnapshotAsset widgetRef = pageReference(WIDGET_REF, "widget-ref", "/nav/products/", WIDGET_PAGE, "Widget");
        SnapshotAsset homePage = page(HOME_PAGE, "home", "/", PAGE_TEMPLATE);
        SnapshotAsset widgetPage = page(WIDGET_PAGE, "widget", "/", PAGE_TEMPLATE);

        Snapshot snapshot = snapshot(template, navRoot, products, widgetRef, homePage, widgetPage);
        GenerationRenderer renderer = new GenerationRenderer(
                snapshot, OutputPathResolver.forSnapshot(snapshot, "index", false, "RELATIVE"), "proj", null);

        RenderedFile file = renderer.render(new PlanEntry(WIDGET_PAGE, "html", "widget.html"));
        String html = new String(file.bytes(), java.nio.charset.StandardCharsets.UTF_8);

        // "products" has no startNode -> grouping-only, rendered as <span>, never a link; the
        // widget page being rendered is the active leaf, so "products" is on its trail.
        assertThat(html).isEqualTo(
                "<ul class=\"nav\">"
                        + "<li class=\"nav-item trail\"><span>products</span>"
                        + "<ul class=\"nav\"><li class=\"nav-item active\"><a href=\"widget.html\">Widget</a></li></ul>"
                        + "</li></ul>");
    }

    @Test
    void startNodeCycleTruncatesAndSurfacesSfGen0410() {
        SnapshotAsset template = pageTemplate(CYCLIC_TEMPLATE, "$CMS_NAVIGATION(nav:cyclic)$");
        SnapshotAsset cyclicRoot = folder(
                CYCLIC_NAV_ROOT,
                "cyclic",
                "/nav-cyclic/",
                "{\"scope\":\"NAVIGATION\",\"startNode\":{\"kind\":\"FOLDER\",\"assetUuid\":\"" + CYCLIC_NAV_ROOT + "\"}}");
        SnapshotAsset cyclicPage = page(CYCLIC_PAGE, "cyclic-page", "/", CYCLIC_TEMPLATE);

        Snapshot snapshot = snapshot(template, cyclicRoot, cyclicPage);
        GenerationRenderer renderer = new GenerationRenderer(
                snapshot, OutputPathResolver.forSnapshot(snapshot, "index", false, "RELATIVE"), "proj", null);

        RenderedFile file = renderer.render(new PlanEntry(CYCLIC_PAGE, "html", "cyclic-page.html"));

        assertThat(file.diagnostics().stream().map(Diagnostic::code))
                .contains(NavigationDiagnosticCodes.NAV_START_NODE_CYCLE);
        assertThat(NavigationDiagnosticCodes.NAV_START_NODE_CYCLE).isEqualTo("SF-GEN-0410");
    }

    @Test
    void danglingPageReferenceFailsRenderWithSfGen0411() {
        UUID missingTarget = UUID.fromString("00000000-0000-0000-0000-0000000000ff");
        SnapshotAsset template = pageTemplate(PAGE_TEMPLATE, "$CMS_NAVIGATION(nav:main)$");
        SnapshotAsset navRoot = folder(NAV_ROOT, "main", "/nav/", "{\"scope\":\"NAVIGATION\"}");
        // Target asset uuid is never added to the snapshot below -> unresolvable (dangling).
        SnapshotAsset danglingRef = pageReference(HOME_REF, "home-ref", "/nav/", missingTarget, "Home");
        SnapshotAsset homePage = page(HOME_PAGE, "home", "/", PAGE_TEMPLATE);

        Snapshot snapshot = snapshot(template, navRoot, danglingRef, homePage);
        GenerationRenderer renderer = new GenerationRenderer(
                snapshot, OutputPathResolver.forSnapshot(snapshot, "index", false, "RELATIVE"), "proj", null);

        assertThatThrownBy(() -> renderer.render(new PlanEntry(HOME_PAGE, "html", "home.html")))
                .isInstanceOf(RenderLimitException.class)
                .satisfies(e -> assertThat(((RenderLimitException) e).diagnostic().code())
                        .isEqualTo(NavigationDiagnosticCodes.NAV_DANGLING_PAGE_REFERENCE));
        assertThat(NavigationDiagnosticCodes.NAV_DANGLING_PAGE_REFERENCE).isEqualTo("SF-GEN-0411");
    }

    @Test
    void navigationHrefsForPageReferenceNodesRouteThroughTheUrlRegistryGeneratedArea() {
        SnapshotAsset template = pageTemplate(PAGE_TEMPLATE, "$CMS_NAVIGATION(nav:main)$");
        SnapshotAsset navRoot = folder(NAV_ROOT, "main", "/nav/", "{\"scope\":\"NAVIGATION\"}");
        SnapshotAsset homeRef = pageReference(HOME_REF, "home-ref", "/nav/", HOME_PAGE, "Home");
        SnapshotAsset aboutRef = pageReference(ABOUT_REF, "about-ref", "/nav/", ABOUT_PAGE, "About Us");
        SnapshotAsset homePage = page(HOME_PAGE, "home", "/", PAGE_TEMPLATE);
        SnapshotAsset aboutPage = page(ABOUT_PAGE, "about", "/", PAGE_TEMPLATE);

        Snapshot snapshot = snapshot(template, navRoot, homeRef, aboutRef, homePage, aboutPage);
        FakeUrlRegistryService registry = new FakeUrlRegistryService();
        GenerationRenderer renderer = new GenerationRenderer(
                snapshot,
                OutputPathResolver.forSnapshot(snapshot, "index", false, "RELATIVE"),
                "proj",
                null,
                registry,
                42L);

        RenderedFile file = renderer.render(new PlanEntry(HOME_PAGE, "html", "home.html"));
        String html = new String(file.bytes(), java.nio.charset.StandardCharsets.UTF_8);

        // Every href comes from the registry (UrlArea.GENERATED), keyed on the PAGE_REFERENCE's
        // own uuid — not the resolved page's uuid.
        assertThat(registry.resolvedPageReferenceUuids).containsExactlyInAnyOrder(HOME_REF, ABOUT_REF);
        assertThat(registry.resolvedAreas).containsOnly(UrlArea.GENERATED);
        assertThat(html).contains("href=\"registry/" + HOME_REF + ".html\"");
        assertThat(html).contains("href=\"registry/" + ABOUT_REF + ".html\"");

        // Second render of the same page (as a second generation run would do) re-resolves the
        // same tuples; the fake's cache (mirroring the real read-through-cache contract) returns
        // the identical url both times.
        String htmlAgain = new String(
                renderer.render(new PlanEntry(HOME_PAGE, "html", "home.html")).bytes(),
                java.nio.charset.StandardCharsets.UTF_8);
        assertThat(htmlAgain).isEqualTo(html);
    }

    /**
     * Minimal in-memory fake proving {@code GenerationRenderer} calls through {@link
     * UrlRegistryService} for PAGE_REFERENCE nav hrefs, keyed by {@code pageReferenceUuid} —
     * mirrors the real read-through-cache contract (`M8.2.2`) closely enough to assert routing
     * and stability without a Spring/DB-backed integration test (that full end-to-end proof,
     * including a real content rename between two full generation runs, lives in
     * {@code NavigationUrlRegistryIntegrationTest}, sf-app).
     */
    private static final class FakeUrlRegistryService implements UrlRegistryService {
        final Map<String, String> store = new HashMap<>();
        final List<UUID> resolvedPageReferenceUuids = new ArrayList<>();
        final List<UrlArea> resolvedAreas = new ArrayList<>();

        @Override
        public String resolve(UUID pageReferenceUuid, String channelKey, UrlArea area, RevisionContext ctx) {
            resolvedPageReferenceUuids.add(pageReferenceUuid);
            resolvedAreas.add(area);
            String key = pageReferenceUuid + ":" + channelKey + ":" + area;
            return store.computeIfAbsent(key, k -> "registry/" + pageReferenceUuid + ".html");
        }

        @Override
        public UrlRegistryEntry override(UUID pageReferenceUuid, String channelKey, UrlArea area, String url, RevisionContext ctx) {
            throw new UnsupportedOperationException("not exercised by this test");
        }

        @Override
        public void reset(long projectId, ResetScope scope, RevisionContext ctx) {
            throw new UnsupportedOperationException("not exercised by this test");
        }

        @Override
        public org.springframework.data.domain.Page<UrlRegistryEntry> search(
                long projectId, String channelKey, UrlArea area, org.springframework.data.domain.Pageable pageable) {
            throw new UnsupportedOperationException("not exercised by this test");
        }

        @Override
        public UrlRegistryEntry require(long projectId, long id) {
            throw new UnsupportedOperationException("not exercised by this test");
        }
    }

    // ------------------------------------------------------------------
    // Fixtures
    // ------------------------------------------------------------------

    private static Snapshot snapshot(SnapshotAsset... assets) {
        Map<UUID, SnapshotAsset> byUuid = new HashMap<>();
        Map<Long, SnapshotAsset> byId = new HashMap<>();
        for (SnapshotAsset asset : assets) {
            byUuid.put(asset.uuid(), asset);
            byId.put(asset.assetId(), asset);
        }
        return new Snapshot(1L, 1L, byUuid, byId);
    }

    private static SnapshotAsset pageTemplate(UUID uuid, String htmlSource) {
        String payloadJson = "{\"channelTemplates\":{\"html\":{\"source\":" + MAPPER.valueToTree(htmlSource) + "}}}";
        return new SnapshotAsset(uuid, Math.abs((long) uuid.hashCode()), AssetType.PAGE_TEMPLATE, "tpl", "Template", "/", parse(payloadJson), false);
    }

    private static SnapshotAsset folder(UUID uuid, String uid, String folderPath, String payloadJson) {
        return new SnapshotAsset(uuid, Math.abs((long) uuid.hashCode()), AssetType.FOLDER, uid, uid, folderPath, parse(payloadJson), false);
    }

    private static SnapshotAsset pageReference(UUID uuid, String uid, String folderPath, UUID targetPage, String label) {
        ObjectNode payload = MAPPER.createObjectNode();
        ObjectNode target = payload.putObject("target");
        target.put("kind", "PAGE");
        target.put("assetUuid", targetPage.toString());
        payload.put("label", label);
        return new SnapshotAsset(uuid, Math.abs((long) uuid.hashCode()), AssetType.PAGE_REFERENCE, uid, uid, folderPath, payload, false);
    }

    private static SnapshotAsset page(UUID uuid, String uid, String folderPath, UUID templateUuid) {
        ObjectNode payload = MAPPER.createObjectNode();
        payload.put("templateRef", templateUuid.toString());
        payload.putObject("content");
        return new SnapshotAsset(uuid, Math.abs((long) uuid.hashCode()), AssetType.PAGE, uid, uid, folderPath, payload, false);
    }

    private static JsonNode parse(String json) {
        try {
            return MAPPER.readTree(json);
        } catch (Exception e) {
            throw new RuntimeException(e);
        }
    }
}
