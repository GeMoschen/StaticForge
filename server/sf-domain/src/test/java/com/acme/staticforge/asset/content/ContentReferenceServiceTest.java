package com.acme.staticforge.asset.content;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.acme.staticforge.asset.Asset;
import com.acme.staticforge.asset.AssetReference;
import com.acme.staticforge.asset.AssetReferenceRepository;
import com.acme.staticforge.asset.AssetRepository;
import com.acme.staticforge.asset.ReferenceKind;
import com.acme.staticforge.common.JsonUtil;
import com.fasterxml.jackson.databind.JsonNode;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/**
 * {@link ContentReferenceService}: the pure {@link ContentReferenceService#extract} scanner and the
 * persisting {@link ContentReferenceService#materialize} wrapper against mock repositories
 * (spec §5.4, §14.3).
 */
class ContentReferenceServiceTest {

    private AssetRepository assets;
    private AssetReferenceRepository references;
    private ContentReferenceService service;

    @BeforeEach
    void setUp() {
        assets = mock(AssetRepository.class);
        references = mock(AssetReferenceRepository.class);
        service = new ContentReferenceService(references, assets);
        when(references.save(any(AssetReference.class))).thenAnswer(i -> i.getArgument(0));
    }

    @Test
    void materializesMediaAndContentReferences() {
        UUID mediaUuid = UUID.randomUUID();
        UUID pageUuid = UUID.randomUUID();
        Asset media = asset(11L);
        Asset page = asset(22L);
        when(assets.findByProjectIdAndUuid(1L, mediaUuid)).thenReturn(Optional.of(media));
        when(assets.findByProjectIdAndUuid(1L, pageUuid)).thenReturn(Optional.of(page));

        JsonNode content = JsonUtil.parse("""
                {
                  "heroImage": { "type": "MEDIA_REF", "uuid": "%s" },
                  "related":   { "type": "ASSET_REF", "uuid": "%s" }
                }
                """.formatted(mediaUuid, pageUuid));

        List<AssetReference> result = service.materialize(1L, 1L, 5L, content);

        assertThat(result).hasSize(2);
        assertThat(result).extracting(AssetReference::getKind)
                .containsExactlyInAnyOrder(ReferenceKind.MEDIA_REF, ReferenceKind.CONTENT_REF);
        assertThat(result).extracting(AssetReference::getToAssetId).containsExactlyInAnyOrder(11L, 22L);
        assertThat(result).extracting(AssetReference::getSourcePath)
                .containsExactlyInAnyOrder("content.heroImage", "content.related");
        assertThat(result).allMatch(r -> r.getFromAssetId() == 1L && r.getValidFromRevision() == 5L);
        verify(references, times(2)).save(any(AssetReference.class));
    }

    @Test
    void mapsLinkKinds() {
        UUID pageUuid = UUID.randomUUID();
        UUID mediaUuid = UUID.randomUUID();
        Asset page = asset(10L);
        Asset media = asset(20L);
        when(assets.findByProjectIdAndUuid(1L, pageUuid)).thenReturn(Optional.of(page));
        when(assets.findByProjectIdAndUuid(1L, mediaUuid)).thenReturn(Optional.of(media));

        JsonNode content = JsonUtil.parse("""
                {
                  "internalLink": { "kind": "INTERNAL", "uuid": "%s" },
                  "mediaLink":    { "kind": "MEDIA",    "uuid": "%s" }
                }
                """.formatted(pageUuid, mediaUuid));

        List<AssetReference> result = service.materialize(1L, 1L, 5L, content);

        assertThat(result).hasSize(2);
        assertThat(result).extracting(AssetReference::getKind)
                .containsExactlyInAnyOrder(ReferenceKind.CONTENT_REF, ReferenceKind.MEDIA_REF);
    }

    @Test
    void skipsDanglingReferences() {
        UUID dangling = UUID.randomUUID();
        when(assets.findByProjectIdAndUuid(1L, dangling)).thenReturn(Optional.empty());

        JsonNode content = JsonUtil.parse("{\"heroImage\":{\"type\":\"MEDIA_REF\",\"uuid\":\"%s\"}}".formatted(dangling));

        List<AssetReference> result = service.materialize(1L, 1L, 5L, content);

        assertThat(result).isEmpty();
        verify(references, never()).save(any(AssetReference.class));
    }

    @Test
    void keepsReferencesAtDistinctPathsToSameTarget() {
        UUID mediaUuid = UUID.randomUUID();
        Asset media = asset(11L);
        when(assets.findByProjectIdAndUuid(1L, mediaUuid)).thenReturn(Optional.of(media));

        JsonNode content = JsonUtil.parse("""
                { "a": { "type": "MEDIA_REF", "uuid": "%s" }, "b": { "type": "MEDIA_REF", "uuid": "%s" } }
                """.formatted(mediaUuid, mediaUuid));

        List<AssetReference> result = service.materialize(1L, 1L, 5L, content);

        assertThat(result).hasSize(2);
        assertThat(result).extracting(AssetReference::getSourcePath)
                .containsExactlyInAnyOrder("content.a", "content.b");
    }

    @Test
    void materializesReferencesInsideLists() {
        UUID mediaUuid = UUID.randomUUID();
        Asset media = asset(11L);
        when(assets.findByProjectIdAndUuid(1L, mediaUuid)).thenReturn(Optional.of(media));

        JsonNode content = JsonUtil.parse("""
                { "gallery": [ { "type": "MEDIA_REF", "uuid": "%s" }, { "type": "MEDIA_REF", "uuid": "%s" } ] }
                """.formatted(mediaUuid, mediaUuid));

        List<AssetReference> result = service.materialize(1L, 1L, 5L, content);

        assertThat(result).hasSize(2);
        assertThat(result).extracting(AssetReference::getSourcePath)
                .containsExactlyInAnyOrder("content.gallery[0]", "content.gallery[1]");
    }

    @Test
    void extractIsPureAndRootsPathsAtTheGivenPath() {
        UUID mediaUuid = UUID.randomUUID();
        UUID cardTemplate = UUID.randomUUID();

        JsonNode content = JsonUtil.parse("""
                {
                  "heroImage": { "type": "MEDIA_REF", "uuid": "%s" },
                  "broken":    { "type": "MEDIA_REF", "uuid": "not-a-uuid" },
                  "cards": { "type": "CATALOG", "cards": [
                    { "instanceId": "c1", "templateRef": "%s", "content": { "img": { "kind": "MEDIA", "uuid": "%s" } } }
                  ] }
                }
                """.formatted(mediaUuid, cardTemplate, mediaUuid));

        List<ExtractedReference> result = service.extract(content, "bodies.main[0].content");

        assertThat(result).containsExactly(
                new ExtractedReference(ReferenceKind.MEDIA_REF, mediaUuid, "bodies.main[0].content.heroImage"),
                new ExtractedReference(
                        ReferenceKind.CONTENT_REF, cardTemplate, "bodies.main[0].content.cards.cards[0].templateRef"),
                new ExtractedReference(
                        ReferenceKind.MEDIA_REF, mediaUuid, "bodies.main[0].content.cards.cards[0].content.img"));
        verify(references, never()).save(any(AssetReference.class));
        verify(assets, never()).findByProjectIdAndUuid(org.mockito.ArgumentMatchers.anyLong(), any());
    }

    @Test
    void extractOfMissingContentIsEmpty() {
        assertThat(service.extract(null, "content")).isEmpty();
        assertThat(service.extract(JsonUtil.parse("null"), "content")).isEmpty();
    }

    private static Asset asset(Long id) {
        Asset asset = mock(Asset.class);
        when(asset.getId()).thenReturn(id);
        return asset;
    }
}
