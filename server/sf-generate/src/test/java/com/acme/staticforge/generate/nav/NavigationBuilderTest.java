package com.acme.staticforge.generate.nav;

import static org.assertj.core.api.Assertions.assertThat;

import com.acme.staticforge.asset.AssetType;
import com.acme.staticforge.generate.GenerationDiagnosticCodes;
import com.acme.staticforge.generate.snapshot.Snapshot;
import com.acme.staticforge.generate.snapshot.SnapshotAsset;
import com.acme.staticforge.structure.ExpandMode;
import com.acme.staticforge.structure.NavNode;
import com.acme.staticforge.structure.OrderClause;
import com.acme.staticforge.structure.RootKind;
import com.acme.staticforge.structure.StructureKind;
import com.acme.staticforge.structure.StructureRoot;
import com.acme.staticforge.structure.StructureSource;
import com.acme.staticforge.template.diagnostic.Diagnostic;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.junit.jupiter.api.Test;

class NavigationBuilderTest {

    private static final ObjectMapper MAPPER = new ObjectMapper();
    private static final UUID HOME = UUID.randomUUID();
    private static final UUID PRODUCTS = UUID.randomUUID();
    private static final UUID HAMMER = UUID.randomUUID();

    private final NavigationBuilder builder = new NavigationBuilder();

    @Test
    void marksActiveAndTrailAlongFolderHierarchy() {
        Snapshot snapshot = snapshot(
                page(HOME, "home", "Home", "/", "{}"),
                page(PRODUCTS, "products", "Products", "/products/", "{}"),
                page(HAMMER, "hammer", "Hammer", "/products/hammers/", "{}"));

        NavNode root = builder.build(snapshot, source(new StructureRoot(RootKind.FOLDER, "/"), ExpandMode.ALL, 5), HAMMER, null, "html")
                .root();

        List<NavNode> top = root.children();
        assertThat(top).hasSize(1);
        NavNode home = top.get(0);
        assertThat(home.label()).isEqualTo("Home");
        assertThat(home.active()).isFalse();
        assertThat(home.trail()).isTrue();

        NavNode products = home.children().get(0);
        assertThat(products.trail()).isTrue();
        assertThat(products.active()).isFalse();

        NavNode hammer = products.children().get(0);
        assertThat(hammer.active()).isTrue();
        assertThat(hammer.trail()).isFalse();
        assertThat(hammer.children()).isEmpty();
    }

    @Test
    void includeAndExcludeFilterPages() {
        Snapshot snapshot = snapshot(
                page(HOME, "a", "A", "/", "{\"nav\":{\"visible\":true}}"),
                page(PRODUCTS, "b", "B", "/", "{\"nav\":{\"visible\":false}}"),
                page(HAMMER, "c", "C", "/", "{\"nav\":{\"noIndex\":true}}"));

        StructureSource source = new StructureSource(
                StructureKind.NAVIGATION,
                new StructureRoot(RootKind.FOLDER, "/"),
                3,
                List.of("nav.visible == true"),
                List.of("nav.noIndex == true"),
                null,
                ExpandMode.NONE);

        NavNode root = builder.build(snapshot, source, null, null, "html").root();
        List<NavNode> top = root.children();
        assertThat(top).hasSize(1);
        assertThat(top.get(0).pageUid()).isEqualTo("a");
    }

    @Test
    void sortsByOrderBy() {
        Snapshot snapshot = snapshot(
                page(HOME, "a", "A", "/", "{\"nav\":{\"position\":3}}"),
                page(PRODUCTS, "b", "B", "/", "{\"nav\":{\"position\":1}}"),
                page(HAMMER, "c", "C", "/", "{\"nav\":{\"position\":2}}"));

        StructureSource source = new StructureSource(
                StructureKind.NAVIGATION,
                new StructureRoot(RootKind.FOLDER, "/"),
                3,
                List.of(),
                List.of(),
                List.of(new OrderClause("nav.position", true)),
                ExpandMode.NONE);

        List<NavNode> top = builder.build(snapshot, source, null, null, "html").root().children();
        assertThat(top).extracting(NavNode::pageUid).containsExactly("b", "c", "a");
    }

    @Test
    void cycleRevisitingUuidIsTruncatedWithSfGen0410() {
        SnapshotAsset a = page(HOME, "a", "A", "/a/", "{}");
        SnapshotAsset b = page(PRODUCTS, "b", "B", "/a/b/", "{}");
        List<NavigationBuilder.PageEntry> candidates =
                List.of(new NavigationBuilder.PageEntry(a), new NavigationBuilder.PageEntry(b));

        StructureSource source = source(new StructureRoot(RootKind.FOLDER, "/"), ExpandMode.ALL, 5);
        Set<UUID> visiting = new HashSet<>();
        visiting.add(PRODUCTS); // simulate B already seen on the descent path
        List<Diagnostic> diagnostics = new ArrayList<>();

        NavNode node = builder.toNode(
                new NavigationBuilder.PageEntry(a),
                candidates,
                0,
                null,
                "",
                null,
                "html",
                source,
                visiting,
                diagnostics);

        assertThat(node.children()).isEmpty();
        assertThat(diagnostics).extracting(Diagnostic::code).contains(GenerationDiagnosticCodes.GEN_NAV_CYCLE);
        assertThat(diagnostics.get(0).message()).contains("cycle", "truncated");
    }

    // ------------------------------------------------------------------
    // Fixtures
    // ------------------------------------------------------------------

    private static StructureSource source(StructureRoot root, ExpandMode expand, int depth) {
        return new StructureSource(StructureKind.NAVIGATION, root, depth, List.of(), List.of(), null, expand);
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

    private static SnapshotAsset page(UUID uuid, String uid, String displayName, String folderPath, String payloadJson) {
        return new SnapshotAsset(
                uuid, Math.abs((long) uuid.hashCode()), AssetType.PAGE, uid, displayName, folderPath, parse(payloadJson), false);
    }

    private static JsonNode parse(String json) {
        try {
            return MAPPER.readTree(json);
        } catch (Exception e) {
            throw new RuntimeException(e);
        }
    }
}
