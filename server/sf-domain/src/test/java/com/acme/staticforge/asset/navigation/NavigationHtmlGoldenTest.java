package com.acme.staticforge.asset.navigation;

import static org.assertj.core.api.Assertions.assertThat;

import com.acme.staticforge.asset.AssetType;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.stream.Stream;
import org.junit.jupiter.api.Test;

/**
 * Directory-driven golden-file tests for {@code $CMS_NAVIGATION}'s default rendering
 * ({@link NavigationTreeJson} + {@link NavigationHtmlRenderer}, `M8.1.4`). Each subdirectory of
 * {@code src/test/resources/navigation/render} holds {@code tree.json} (a hand-built
 * {@link NavTreeNode}, in the exact shape {@code NavigationService#tree} returns), an optional
 * {@code active.txt} (the "current page" UUID for active/trail marking; absent means no page is
 * active) and {@code expected.html}. Mirrors {@code GoldenFileRenderTest} in {@code sf-template}.
 *
 * <p>Covers the flat-folder, nested-folder and null-{@code startNode}-grouping acceptance
 * criteria; cycle truncation surfacing {@code SF-GEN-0410} is a property of tree *construction*
 * (already covered by {@code NavigationServiceImplTest}, `M8.1.3`) and of this task's render
 * wiring surfacing it into the run's diagnostics/warnings — covered separately by
 * {@code GenerationRendererNavigationTest} (sf-generate), which exercises the full
 * render-a-page-with-a-cyclic-nav-folder path end to end.
 */
class NavigationHtmlGoldenTest {

    private final ObjectMapper mapper = new ObjectMapper();

    @Test
    void rendersGoldenCorpus() throws Exception {
        Path root = Path.of("src/test/resources/navigation/render");
        assertThat(Files.isDirectory(root)).as("navigation render corpus directory exists").isTrue();

        List<Path> cases;
        try (Stream<Path> stream = Files.list(root)) {
            cases = stream.filter(Files::isDirectory).sorted().toList();
        }
        assertThat(cases).as("corpus is non-empty").isNotEmpty();

        for (Path dir : cases) {
            NavTreeNode tree = readTree(mapper.readTree(dir.resolve("tree.json").toFile()));
            Path activeFile = dir.resolve("active.txt");
            UUID activePageUuid = Files.exists(activeFile)
                    ? parseUuidOrNull(Files.readString(activeFile).trim())
                    : null;
            String expected = Files.readString(dir.resolve("expected.html"));

            JsonNode json = NavigationTreeJson.toJson(tree, activePageUuid, node -> "/page/" + node.resolvedPageUuid() + "/");
            String actual = NavigationHtmlRenderer.renderRoot(json);

            assertThat(normalize(actual))
                    .as("case %s\n--- actual ---\n%s\n--- expected ---\n%s", dir.getFileName(), actual, expected)
                    .isEqualTo(normalize(expected));
        }
    }

    /** A grouping-only node (null {@code href}) never renders as a link, even when it has no children. */
    @Test
    void groupingOnlyLeafRendersAsSpanNotAnchor() {
        NavTreeNode leaf = new NavTreeNode(UUID.randomUUID(), AssetType.FOLDER, "empty", "Empty", "Empty", null, false, List.of());
        NavTreeNode root = new NavTreeNode(UUID.randomUUID(), AssetType.FOLDER, "root", "Root", "Root", null, false, List.of(leaf));

        JsonNode json = NavigationTreeJson.toJson(root, null, node -> "/page/" + node.resolvedPageUuid() + "/");
        String html = NavigationHtmlRenderer.renderRoot(json);

        assertThat(html).contains("<span>Empty</span>").doesNotContain("<a href");
    }

    /** A hidden item leaves the menu with its whole subtree; its siblings and the trail of the rest are unaffected. */
    @Test
    void aHiddenItemAndItsSubtreeAreNotRendered() {
        UUID visiblePage = UUID.randomUUID();
        UUID hiddenPage = UUID.randomUUID();
        UUID nestedPage = UUID.randomUUID();
        NavTreeNode nested = node(UUID.randomUUID(), AssetType.PAGE_REFERENCE, "nested", "Nested under hidden", nestedPage, true, List.of());
        NavTreeNode hiddenFolder = node(UUID.randomUUID(), AssetType.FOLDER, "hidden-folder", "Hidden folder", hiddenPage, false, List.of(nested));
        NavTreeNode hiddenLeaf = node(UUID.randomUUID(), AssetType.PAGE_REFERENCE, "hidden-leaf", "Hidden leaf", UUID.randomUUID(), false, List.of());
        NavTreeNode shown = node(UUID.randomUUID(), AssetType.PAGE_REFERENCE, "shown", "Shown", visiblePage, true, List.of());
        NavTreeNode root = node(UUID.randomUUID(), AssetType.FOLDER, "root", "Root", null, true, List.of(shown, hiddenFolder, hiddenLeaf));

        // The page being rendered lies in the hidden subtree: it marks nothing in the menu.
        JsonNode json = NavigationTreeJson.toJson(root, nestedPage, n -> "/page/" + n.resolvedPageUuid() + "/");
        String html = NavigationHtmlRenderer.renderRoot(json);

        assertThat(html).isEqualTo("<ul class=\"nav\"><li class=\"nav-item\"><a href=\"/page/" + visiblePage + "/\">Shown</a></li></ul>");
        assertThat(json.path("children")).hasSize(1);
        assertThat(json.path("children").get(0).path("visibleInMenu").asBoolean()).isTrue();
    }

    /** Every child hidden: no empty list is rendered. */
    @Test
    void aFolderWhoseChildrenAreAllHiddenRendersNoList() {
        NavTreeNode hidden = node(UUID.randomUUID(), AssetType.PAGE_REFERENCE, "h", "Hidden", UUID.randomUUID(), false, List.of());
        NavTreeNode root = node(UUID.randomUUID(), AssetType.FOLDER, "root", "Root", null, true, List.of(hidden));

        assertThat(NavigationHtmlRenderer.renderRoot(NavigationTreeJson.toJson(root, null, n -> "/x/"))).isEmpty();
    }

    /** The renderer also honours the flag in hand-built JSON (the default is visible). */
    @Test
    void theRendererSkipsJsonNodesMarkedInvisible() throws Exception {
        JsonNode json = mapper.readTree("""
                {"children":[
                  {"label":"A","href":"/a/","children":[]},
                  {"label":"B","href":"/b/","visibleInMenu":false,"children":[{"label":"C","href":"/c/","children":[]}]}
                ]}""");

        assertThat(NavigationHtmlRenderer.renderRoot(json))
                .isEqualTo("<ul class=\"nav\"><li class=\"nav-item\"><a href=\"/a/\">A</a></li></ul>");
    }

    private static NavTreeNode node(
            UUID assetUuid, AssetType type, String uid, String label, UUID resolvedPageUuid, boolean visible, List<NavTreeNode> children) {
        return new NavTreeNode(assetUuid, type, uid, label, label, resolvedPageUuid, false, visible, children);
    }

    // ------------------------------------------------------------------
    // tree.json -> NavTreeNode (manual walk; avoids relying on Jackson's record-deserialization
    // support, which needs -parameters/a names module this module doesn't otherwise need).
    // ------------------------------------------------------------------

    private NavTreeNode readTree(JsonNode json) {
        UUID assetUuid = parseUuidOrNull(textOrNull(json, "assetUuid"));
        AssetType type = AssetType.valueOf(json.path("type").asText());
        String uid = textOrNull(json, "uid");
        String displayName = textOrNull(json, "displayName");
        String label = textOrNull(json, "label");
        UUID resolvedPageUuid = parseUuidOrNull(textOrNull(json, "resolvedPageUuid"));
        boolean visibleInMenu = json.path("visibleInMenu").asBoolean(true);
        List<NavTreeNode> children = new ArrayList<>();
        for (JsonNode child : json.path("children")) {
            children.add(readTree(child));
        }
        return new NavTreeNode(assetUuid, type, uid, displayName, label, resolvedPageUuid, false, visibleInMenu, children);
    }

    private static String textOrNull(JsonNode node, String field) {
        JsonNode value = node.get(field);
        return value == null || value.isNull() ? null : value.asText();
    }

    private static UUID parseUuidOrNull(String text) {
        if (text == null || text.isBlank()) {
            return null;
        }
        return UUID.fromString(text);
    }

    private static String normalize(String s) {
        String normalized = s.replace("\r\n", "\n");
        if (normalized.endsWith("\n")) {
            normalized = normalized.substring(0, normalized.length() - 1);
        }
        return normalized;
    }
}
