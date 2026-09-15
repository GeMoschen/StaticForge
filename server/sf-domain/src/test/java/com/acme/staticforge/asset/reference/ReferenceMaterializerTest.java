package com.acme.staticforge.asset.reference;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.acme.staticforge.asset.Asset;
import com.acme.staticforge.asset.AssetReference;
import com.acme.staticforge.asset.AssetReferenceRepository;
import com.acme.staticforge.asset.AssetRepository;
import com.acme.staticforge.asset.AssetType;
import com.acme.staticforge.asset.AssetVersionRepository;
import com.acme.staticforge.asset.ReferenceKind;
import com.acme.staticforge.asset.content.ContentReferenceService;
import com.acme.staticforge.common.JsonUtil;
import com.fasterxml.jackson.databind.JsonNode;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/** {@link ReferenceMaterializer}: edge derivation per asset type and the per-edge interval diff (spec §5.4). */
class ReferenceMaterializerTest {

    private static final long PROJECT = 1L;
    private static final long FROM = 100L;

    private final UUID pageTemplate = UUID.randomUUID();
    private final UUID sectionTemplate = UUID.randomUUID();
    private final UUID media = UUID.randomUUID();
    private final UUID page = UUID.randomUUID();

    private AssetRepository assets;
    private AssetReferenceRepository references;
    private ReferenceMaterializer materializer;

    @BeforeEach
    void setUp() {
        assets = mock(AssetRepository.class);
        references = mock(AssetReferenceRepository.class);
        materializer = new ReferenceMaterializer(
                references,
                assets,
                new ContentReferenceService(),
                new ProjectReferenceResolver(assets, mock(AssetVersionRepository.class)));
        List<Asset> targets = List.of(
                asset(pageTemplate, 11L), asset(sectionTemplate, 12L), asset(media, 13L), asset(page, 14L));
        when(assets.findByProjectIdAndUuidIn(eq(PROJECT), any())).thenReturn(targets);
        when(references.findByFromAssetIdAndValidToRevisionIsNull(FROM)).thenReturn(List.of());
        when(references.findByFromAssetIdAndValidToRevision(eq(FROM), anyLong())).thenReturn(List.of());
    }

    @Test
    void derivesTemplateContentAndSectionEdgesFromAPage() {
        JsonNode payload = JsonUtil.parse("""
                {
                  "templateRef": "%s",
                  "content": { "hero": { "type": "MEDIA_REF", "uuid": "%s" }, "gone": { "type": "MEDIA_REF", "uuid": "%s" } },
                  "bodies": { "main": [
                    { "instanceId": "s1", "templateRef": "%s", "content": { "link": { "kind": "INTERNAL", "uuid": "%s" } } }
                  ] }
                }
                """.formatted(pageTemplate, media, UUID.randomUUID(), sectionTemplate, page));

        assertThat(materializer.extract(PROJECT, AssetType.PAGE, payload)).containsExactly(
                new ReferenceEdge(11L, ReferenceKind.TEMPLATE, "templateRef"),
                new ReferenceEdge(13L, ReferenceKind.MEDIA_REF, "content.hero"),
                new ReferenceEdge(12L, ReferenceKind.TEMPLATE, "bodies.main[0].templateRef"),
                new ReferenceEdge(14L, ReferenceKind.CONTENT_REF, "bodies.main[0].content.link"));
    }

    @Test
    void derivesANavEdgeFromAPageReference() {
        JsonNode payload = JsonUtil.parse("{\"target\":{\"kind\":\"PAGE\",\"assetUuid\":\"%s\"}}".formatted(page));

        assertThat(materializer.extract(PROJECT, AssetType.PAGE_REFERENCE, payload))
                .containsExactly(new ReferenceEdge(14L, ReferenceKind.NAV, "target"));
    }

    @Test
    void derivesOctlEdgesPerChannelFromATemplate() {
        Asset teaser = asset(sectionTemplate, 12L);
        Asset about = asset(page, 14L);
        when(assets.findByProjectIdAndAssetTypeAndUid(PROJECT, AssetType.SECTION_TEMPLATE, "teaser"))
                .thenReturn(java.util.Optional.of(teaser));
        when(assets.findByProjectIdAndAssetTypeAndUid(PROJECT, AssetType.PAGE, "about"))
                .thenReturn(java.util.Optional.of(about));
        JsonNode payload = JsonUtil.parse("""
                { "channelTemplates": {
                    "html": { "source": "$CMS_INCLUDE(section_template:teaser)$ $CMS_VALUE(page:about.title)$ $CMS_REF(page:nope)$" },
                    "markdown": { "source": "$CMS_REF(page:about)$" }
                } }
                """);

        assertThat(materializer.extract(PROJECT, AssetType.PAGE_TEMPLATE, payload)).containsExactlyInAnyOrder(
                new ReferenceEdge(12L, ReferenceKind.OCTL_INCLUDE, "channelTemplates.html"),
                new ReferenceEdge(14L, ReferenceKind.OCTL_VALUE, "channelTemplates.html"),
                new ReferenceEdge(14L, ReferenceKind.OCTL_REF, "channelTemplates.markdown"));
    }

    @Test
    void mediaAndFoldersHaveNoEdgesAndNeedNoLookup() {
        JsonNode payload = JsonUtil.parse("{\"blobSha256\":\"abc\"}");

        assertThat(materializer.extract(PROJECT, AssetType.MEDIA, payload)).isEmpty();
        assertThat(materializer.extract(PROJECT, AssetType.FOLDER, payload)).isEmpty();
        verify(assets, never()).findByProjectIdAndUuidIn(anyLong(), any());
    }

    @Test
    void keepsUnchangedEdgesClosesRemovedOnesAndInsertsNewOnes() {
        AssetReference kept = row(11L, ReferenceKind.TEMPLATE, "templateRef", 3L);
        AssetReference removed = row(13L, ReferenceKind.MEDIA_REF, "content.hero", 3L);
        when(references.findByFromAssetIdAndValidToRevisionIsNull(FROM)).thenReturn(List.of(kept, removed));
        List<AssetReference> saved = captureSaves();

        materializer.replaceOutgoing(PROJECT, FROM, 7L, AssetType.PAGE, JsonUtil.parse("""
                { "templateRef": "%s", "content": { "link": { "kind": "INTERNAL", "uuid": "%s" } } }
                """.formatted(pageTemplate, page)));

        assertThat(kept.getValidToRevision()).isNull();
        assertThat(removed.getValidToRevision()).isEqualTo(7L);
        assertThat(saved).extracting(AssetReference::getToAssetId).containsExactly(13L, 14L);
        AssetReference inserted = saved.get(1);
        assertThat(inserted.getValidFromRevision()).isEqualTo(7L);
        assertThat(inserted.getKind()).isEqualTo(ReferenceKind.CONTENT_REF);
    }

    @Test
    void anEdgeOpenedAndDroppedInOneRevisionIsDeletedNotClosed() {
        AssetReference sameRevision = row(13L, ReferenceKind.MEDIA_REF, "content.hero", 7L);
        when(references.findByFromAssetIdAndValidToRevisionIsNull(FROM)).thenReturn(List.of(sameRevision));

        materializer.closeOutgoing(FROM, 7L);

        verify(references).delete(sameRevision);
        assertThat(sameRevision.getValidToRevision()).isNull();
    }

    @Test
    void anEdgeClosedEarlierInTheSameRevisionIsReopenedNotDuplicated() {
        AssetReference closedNow = row(13L, ReferenceKind.MEDIA_REF, "content.hero", 3L);
        closedNow.setValidToRevision(7L);
        when(references.findByFromAssetIdAndValidToRevision(FROM, 7L)).thenReturn(List.of(closedNow));
        List<AssetReference> saved = captureSaves();

        materializer.replaceOutgoing(PROJECT, FROM, 7L, AssetType.PAGE, JsonUtil.parse("""
                { "content": { "hero": { "type": "MEDIA_REF", "uuid": "%s" } } }
                """.formatted(media)));

        assertThat(closedNow.getValidToRevision()).isNull();
        assertThat(saved).containsExactly(closedNow);
    }

    private List<AssetReference> captureSaves() {
        List<AssetReference> saved = new ArrayList<>();
        when(references.save(any(AssetReference.class))).thenAnswer(invocation -> {
            AssetReference ref = invocation.getArgument(0);
            saved.add(ref);
            return ref;
        });
        return saved;
    }

    private static AssetReference row(long to, ReferenceKind kind, String path, long from) {
        return new AssetReference(FROM, from, to, kind, path);
    }

    private static Asset asset(UUID uuid, long id) {
        Asset asset = mock(Asset.class);
        when(asset.getUuid()).thenReturn(uuid);
        when(asset.getId()).thenReturn(id);
        return asset;
    }
}
