package com.acme.staticforge.generate.nav;

import static org.assertj.core.api.Assertions.assertThat;

import com.acme.staticforge.asset.AssetType;
import com.acme.staticforge.generate.render.OutputPathResolver;
import com.acme.staticforge.generate.snapshot.Snapshot;
import com.acme.staticforge.generate.snapshot.SnapshotAsset;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.Test;

/**
 * Golden nav-render tests (spec §17.1, §17.2) for both the {@code html} and {@code markdown}
 * channels. Hand-builds a small site (four visible pages plus one {@code nav.visible == false}
 * page), a single navigation structure whose source filters/orders by {@code nav.*} and expands
 * fully, then renders both channel templates and asserts the exact output — including the
 * {@code is-active}/{@code is-trail}/{@code aria-current} marking on the active page's trail and
 * the {@code $CMS_NAV_RECURSE} nesting that stops at the configured {@code depth}.
 */
class NavGoldenTest {

    private static final ObjectMapper MAPPER = new ObjectMapper();

    private static final UUID HOME = UUID.randomUUID();
    private static final UUID PRODUCTS = UUID.randomUUID();
    private static final UUID DRILLS = UUID.randomUUID();
    private static final UUID HAMMERS = UUID.randomUUID();
    private static final UUID HIDDEN = UUID.randomUUID();
    private static final UUID STRUCTURE = UUID.randomUUID();

    private static final String HTML_TEMPLATE =
            "<ul>$CMS_FOR(node : nodes)$<li class=\"$CMS_IF(node.active)$is-active$CMS_END_IF$$CMS_IF(node.trail)$is-trail$CMS_END_IF$\"$CMS_IF(node.active)$ aria-current=\"page\"$CMS_END_IF$><a href=\"$CMS_VALUE(node.href)$\">$CMS_VALUE(node.label)$</a>$CMS_IF(node.children | size > 0)$$CMS_NAV_RECURSE(node)$$CMS_END_IF$</li>$CMS_END_FOR$</ul>";

    private static final String MARKDOWN_TEMPLATE =
            "$CMS_FOR(node : nodes)$- [$CMS_VALUE(node.label)$]($CMS_VALUE(node.href)$)$CMS_IF(node.active)$ **[active]**$CMS_END_IF$$CMS_IF(node.children | size > 0)$$CMS_NAV_RECURSE(node)$$CMS_END_IF$$CMS_END_FOR$";

    private static final String EXPECTED_HTML =
            "<ul><li class=\"is-trail\"><a href=\"home.html\">Home</a><ul><li class=\"is-trail\"><a href=\"products/products.html\">Products</a><ul><li class=\"is-active\" aria-current=\"page\"><a href=\"products/drills/drills.html\">Drills</a></li></ul></li></ul></li></ul>";

    private static final String EXPECTED_MARKDOWN =
            "- [Home](home.md)- [Products](products/products.md)- [Drills](products/drills/drills.md) **[active]**";

    private static final String SOURCE_TEXT = """
            navigation {
              source {
                root      page:home
                depth     3
                include   pages where nav.visible == true
                order by  nav.position asc
                expand    all
              }
            }
            """;

    private final NavigationBuilder navigationBuilder = new NavigationBuilder();

    @Test
    void rendersHtmlNavigationWithActiveTrailAndRecursion() {
        NavRenderer.NavRenderResult result = render("html");

        assertThat(result.diagnostics()).isEmpty();
        assertThat(result.output()).isEqualTo(EXPECTED_HTML);
        assertThat(result.dependencies()).contains(STRUCTURE, HOME, PRODUCTS, DRILLS);
    }

    @Test
    void rendersMarkdownNavigationWithActiveMarker() {
        NavRenderer.NavRenderResult result = render("markdown");

        assertThat(result.diagnostics()).isEmpty();
        assertThat(result.output()).isEqualTo(EXPECTED_MARKDOWN);
        assertThat(result.dependencies()).contains(STRUCTURE, HOME, PRODUCTS, DRILLS);
    }

    private NavRenderer.NavRenderResult render(String channel) {
        Snapshot snapshot = snapshot(home(), products(), drills(), hammers(), hidden(), structure());
        OutputPathResolver paths = OutputPathResolver.forSnapshot(snapshot, "index", false, "DEFAULT");
        NavRenderer renderer = new NavRenderer(null, navigationBuilder);
        return renderer.renderNav(snapshot, STRUCTURE, "main_nav", DRILLS, channel, paths);
    }

    // ------------------------------------------------------------------
    // Fixtures
    // ------------------------------------------------------------------

    private static SnapshotAsset home() {
        return page(HOME, "home", "Home", "/", 1, true, "Home");
    }

    private static SnapshotAsset products() {
        return page(PRODUCTS, "products", "Products", "/products/", 2, true, "Products");
    }

    private static SnapshotAsset drills() {
        return page(DRILLS, "drills", "Drills", "/products/drills/", 3, true, "Drills");
    }

    private static SnapshotAsset hammers() {
        return page(HAMMERS, "hammers", "Hammers", "/products/drills/hammers/", 4, true, "Hammers");
    }

    private static SnapshotAsset hidden() {
        return page(HIDDEN, "hidden", "Hidden", "/products/", 5, false, "Hidden");
    }

    private static SnapshotAsset structure() {
        ObjectNode payload = MAPPER.createObjectNode();
        payload.put("kind", "NAVIGATION");
        payload.put("sourceText", SOURCE_TEXT);
        ObjectNode channelTemplates = payload.putObject("channelTemplates");
        channelTemplates.putObject("html").put("source", HTML_TEMPLATE);
        channelTemplates.putObject("markdown").put("source", MARKDOWN_TEMPLATE);
        return new SnapshotAsset(
                STRUCTURE, Math.abs((long) STRUCTURE.hashCode()), AssetType.STRUCTURE, "main_nav", "main_nav", "/", payload, false);
    }

    private static SnapshotAsset page(
            UUID uuid, String uid, String displayName, String folderPath, int position, boolean visible, String label) {
        ObjectNode nav = MAPPER.createObjectNode();
        nav.put("visible", visible);
        nav.put("position", position);
        nav.put("label", label);
        ObjectNode payload = MAPPER.createObjectNode();
        payload.set("nav", nav);
        return new SnapshotAsset(
                uuid, Math.abs((long) uuid.hashCode()), AssetType.PAGE, uid, displayName, folderPath, payload, false);
    }

    private static Snapshot snapshot(SnapshotAsset... assets) {
        Map<UUID, SnapshotAsset> byUuid = new HashMap<>();
        Map<Long, SnapshotAsset> byId = new HashMap<>();
        for (SnapshotAsset asset : assets) {
            byUuid.put(asset.uuid(), asset);
            byId.put(asset.assetId(), asset);
        }
        return new Snapshot(1L, 1L, byUuid, byId);
    }
}
