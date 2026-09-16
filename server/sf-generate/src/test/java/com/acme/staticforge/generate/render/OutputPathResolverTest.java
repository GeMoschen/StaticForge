package com.acme.staticforge.generate.render;

import static org.assertj.core.api.Assertions.assertThat;

import com.acme.staticforge.asset.AssetType;
import com.acme.staticforge.channel.ChannelOutputSettings;
import com.acme.staticforge.channel.ChannelOutputSettings.UrlStrategy;
import com.acme.staticforge.generate.plan.PlanEntry;
import com.acme.staticforge.generate.snapshot.Snapshot;
import com.acme.staticforge.generate.snapshot.SnapshotAsset;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.Test;

/** {@link OutputPathResolver} against the §18.3 worked examples and per-channel {@link ChannelOutputSettings}. */
class OutputPathResolverTest {

    private static final ObjectMapper MAPPER = new ObjectMapper();

    private static final UUID PAGE = UUID.randomUUID();
    private static final UUID PAGE_B = UUID.randomUUID();
    private static final UUID TEMPLATE = UUID.randomUUID();

    private static final ChannelOutputSettings PRETTY_SLASH =
            new ChannelOutputSettings("html", null, null, UrlStrategy.PRETTY, true);

    @Test
    void defaultExpressionIsFolderUidExt() {
        SnapshotAsset page = page(PAGE, "hammer", "hammer", "/products/", "{}", null);
        OutputPathResolver resolver = OutputPathResolver.forSnapshot(snapshot(page), Map.of());

        assertThat(resolver.resolvePagePath(PAGE, "html")).isEqualTo("products/hammer.html");
        assertThat(resolver.resolvePageUrl(PAGE, "html")).isEqualTo("products/hammer.html");
    }

    @Test
    void markdownChannelWithoutFileExtensionFallsBackToMd() {
        SnapshotAsset page = page(PAGE, "hammer", "hammer", "/products/", "{}", null);
        OutputPathResolver resolver = OutputPathResolver.forSnapshot(
                snapshot(page), Map.of("markdown", ChannelOutputSettings.of("markdown", null, null)));

        assertThat(resolver.resolvePagePath(PAGE, "markdown")).isEqualTo("products/hammer.md");
    }

    @Test
    void customFileExtensionIsUsedForExt() {
        SnapshotAsset page = page(PAGE, "hammer", "hammer", "/products/", "{}", null);
        OutputPathResolver resolver = OutputPathResolver.forSnapshot(
                snapshot(page), Map.of("html", ChannelOutputSettings.of("html", "htm", null)));

        assertThat(resolver.resolvePagePath(PAGE, "html")).isEqualTo("products/hammer.htm");
        assertThat(resolver.resolvePageUrl(PAGE, "html")).isEqualTo("products/hammer.htm");
    }

    @Test
    void relativeStrategyIgnoresTrailingSlash() {
        SnapshotAsset page = page(PAGE, "hammer", "hammer", "/products/", "{}", null);
        OutputPathResolver resolver = OutputPathResolver.forSnapshot(
                snapshot(page), Map.of("html", new ChannelOutputSettings("html", null, null, UrlStrategy.RELATIVE, true)));

        assertThat(resolver.resolvePagePath(PAGE, "html")).isEqualTo("products/hammer.html");
        assertThat(resolver.resolvePageUrl(PAGE, "html")).isEqualTo("products/hammer.html");
    }

    @Test
    void prettyWithoutTrailingSlashKeepsFileUrls() {
        SnapshotAsset page = page(PAGE, "hammer", "hammer", "/products/", "{}", null);
        OutputPathResolver resolver = OutputPathResolver.forSnapshot(
                snapshot(page), Map.of("html", new ChannelOutputSettings("html", null, null, UrlStrategy.PRETTY, false)));

        assertThat(resolver.resolvePagePath(PAGE, "html")).isEqualTo("products/hammer.html");
        assertThat(resolver.resolvePageUrl(PAGE, "html")).isEqualTo("products/hammer.html");
    }

    @Test
    void prettyTrailingSlashMovesPageIntoDirectory() {
        SnapshotAsset page = page(PAGE, "hammer", "hammer", "/products/", "{}", null);
        OutputPathResolver resolver = OutputPathResolver.forSnapshot(snapshot(page), Map.of("html", PRETTY_SLASH));

        assertThat(resolver.resolvePagePath(PAGE, "html")).isEqualTo("products/hammer/index.html");
        assertThat(resolver.resolvePageUrl(PAGE, "html")).isEqualTo("products/hammer/");
    }

    @Test
    void prettyTrailingSlashUsesTheConfiguredIndexFileName() {
        SnapshotAsset page = page(PAGE, "hammer", "hammer", "/products/", "{}", null);
        ChannelOutputSettings settings = new ChannelOutputSettings("htm", null, "default.htm", UrlStrategy.PRETTY, true);
        OutputPathResolver resolver = OutputPathResolver.forSnapshot(snapshot(page), Map.of("html", settings));

        assertThat(resolver.resolvePagePath(PAGE, "html")).isEqualTo("products/hammer/default.htm");
        assertThat(resolver.resolvePageUrl(PAGE, "html")).isEqualTo("products/hammer/");
    }

    @Test
    void indexPageStaysAtFolderRootEvenWithPretty() {
        SnapshotAsset page = page(PAGE, "index", "index", "/", "{}", null);
        OutputPathResolver resolver = OutputPathResolver.forSnapshot(snapshot(page), Map.of("html", PRETTY_SLASH));

        assertThat(resolver.resolvePagePath(PAGE, "html")).isEqualTo("index.html");
        // Never blank: an empty href would resolve to the linking page itself.
        assertThat(resolver.resolvePageUrl(PAGE, "html")).isEqualTo("./");
    }

    @Test
    void customIndexUidRendersThatPageAsTheFolderIndex() {
        SnapshotAsset home = page(PAGE, "home", "Home", "/products/", "{}", null);
        SnapshotAsset index = page(PAGE_B, "index", "Index", "/", "{}", null);
        ObjectNode settings = MAPPER.createObjectNode().put("indexUid", "home");
        OutputPathResolver resolver = OutputPathResolver.forSnapshot(
                snapshot(home, index), Map.of("html", ChannelOutputSettings.of("html", "html", settings)));

        assertThat(resolver.resolvePagePath(PAGE, "html")).isEqualTo("products/index.html");
        // A page that merely has the uid "index" is an ordinary page now.
        assertThat(resolver.resolvePagePath(PAGE_B, "html")).isEqualTo("index.html");
    }

    @Test
    void settingsApplyPerChannel() {
        SnapshotAsset page = page(PAGE, "hammer", "hammer", "/products/", "{}", null);
        OutputPathResolver resolver = OutputPathResolver.forSnapshot(snapshot(page), Map.of("html", PRETTY_SLASH));

        assertThat(resolver.resolvePagePath(PAGE, "html")).isEqualTo("products/hammer/index.html");
        assertThat(resolver.resolvePagePath(PAGE, "markdown")).isEqualTo("products/hammer.md");
    }

    @Test
    void pathOverrideWinsOverTemplate() {
        SnapshotAsset template = template("{\"outputPath\":{\"html\":\"{folder}{uid}.html\"}}");
        SnapshotAsset page = page(
                PAGE, "hammer", "hammer", "/products/", "{\"output\":{\"pathOverride\":{\"html\":\"custom/landing.html\"}}}", TEMPLATE);
        OutputPathResolver resolver = OutputPathResolver.forSnapshot(snapshot(page, template), Map.of());

        assertThat(resolver.resolvePagePath(PAGE, "html")).isEqualTo("custom/landing.html");
    }

    @Test
    void expandsPlaceholders() {
        SnapshotAsset template = template("{\"outputPath\":{\"html\":\"{folder}{displayNameSlug}-{year}-{month}-{day}.{ext}\"}}");
        SnapshotAsset page = page(
                PAGE, "hammer", "Hammer Drill", "/products/", "{\"nav\":{\"date\":\"2026-08-20\"}}", TEMPLATE);
        OutputPathResolver resolver = OutputPathResolver.forSnapshot(snapshot(page, template), Map.of());

        assertThat(resolver.resolvePagePath(PAGE, "html")).isEqualTo("products/hammer-drill-2026-08-20.html");
    }

    @Test
    void collisionListsBothAssetUids() {
        SnapshotAsset pageA = page(PAGE, "a", "a", "/", "{\"output\":{\"pathOverride\":{\"html\":\"dupe.html\"}}}", null);
        SnapshotAsset pageB = page(PAGE_B, "b", "b", "/", "{\"output\":{\"pathOverride\":{\"html\":\"dupe.html\"}}}", null);
        OutputPathResolver resolver = OutputPathResolver.forSnapshot(snapshot(pageA, pageB), Map.of());

        List<OutputPathResolver.Collision> collisions = resolver.findCollisions(List.of(
                new PlanEntry(PAGE, "html", "dupe.html"),
                new PlanEntry(PAGE_B, "html", "dupe.html")));

        assertThat(collisions).containsExactly(new OutputPathResolver.Collision("dupe.html", "a", "b"));
    }

    @Test
    void paginatedOutputsAreOwnedByPageAndPageNumber() {
        SnapshotAsset blog = page(PAGE, "blog", "Blog", "/", "{}", null);
        SnapshotAsset other = page(PAGE_B, "b", "b", "/", "{}", null);
        OutputPathResolver resolver = OutputPathResolver.forSnapshot(snapshot(blog, other), Map.of());
        com.acme.staticforge.generate.plan.PaginatedPage paginated = new com.acme.staticforge.generate.plan.PaginatedPage(
                UUID.randomUUID(), 1, items(2), List.of("blog.html", "blog-2.html"), List.of());

        assertThat(resolver.resolvePaginationPath(PAGE, "html", "blog.html", 2)).isEqualTo("blog-2.html");
        assertThat(resolver.findCollisions(List.of(
                        new PlanEntry(PAGE, "html", "blog-2.html", new PlanEntry.Pagination(2, paginated)),
                        new PlanEntry(PAGE_B, "html", "blog-2.html"))))
                .containsExactly(new OutputPathResolver.Collision("blog-2.html", "blog (page 2)", "b"));
        // Two page numbers of one page on one path collide too; the same page in two channels does not.
        assertThat(resolver.findCollisions(List.of(
                        new PlanEntry(PAGE, "html", "same.html", new PlanEntry.Pagination(1, paginated)),
                        new PlanEntry(PAGE, "html", "same.html", new PlanEntry.Pagination(2, paginated)))))
                .containsExactly(new OutputPathResolver.Collision("same.html", "blog", "blog (page 2)"));
        assertThat(resolver.findCollisions(List.of(
                        new PlanEntry(PAGE, "html", "blog.html"), new PlanEntry(PAGE, "md", "blog.html"))))
                .isEmpty();
    }

    private static List<com.acme.staticforge.pagination.PaginationItem> items(int count) {
        List<com.acme.staticforge.pagination.PaginationItem> items = new java.util.ArrayList<>();
        for (int i = 0; i < count; i++) {
            items.add(new com.acme.staticforge.pagination.PaginationItem(
                    UUID.randomUUID(), "p" + i, "P" + i, "P" + i, null, 0, UUID.randomUUID(), null));
        }
        return items;
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

    private static SnapshotAsset template(String payloadJson) {
        return new SnapshotAsset(
                TEMPLATE, 9001L, AssetType.PAGE_TEMPLATE, "", "", "/", parse(payloadJson), false);
    }

    private static SnapshotAsset page(
            UUID uuid, String uid, String displayName, String folderPath, String payloadJson, UUID templateUuid) {
        JsonNode payload = parse(payloadJson);
        if (templateUuid != null) {
            ((ObjectNode) payload).put("templateRef", templateUuid.toString());
        }
        return new SnapshotAsset(uuid, Math.abs((long) uuid.hashCode()), AssetType.PAGE, uid, displayName, folderPath, payload, false);
    }

    private static JsonNode parse(String json) {
        try {
            return MAPPER.readTree(json);
        } catch (Exception e) {
            throw new RuntimeException(e);
        }
    }
}
