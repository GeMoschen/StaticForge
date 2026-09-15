package com.acme.staticforge.asset.content;

import static org.assertj.core.api.Assertions.assertThat;

import com.acme.staticforge.asset.ReferenceKind;
import com.acme.staticforge.common.JsonUtil;
import com.fasterxml.jackson.databind.JsonNode;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.Test;

/**
 * {@link ContentReferenceService#extract}, the pure content-reference scanner (spec §5.4, §14.3).
 * Persistence of the extracted edges is covered by {@code ReferenceMaterializerTest}.
 */
class ContentReferenceServiceTest {

    private final ContentReferenceService service = new ContentReferenceService();

    @Test
    void extractsMediaAndContentReferences() {
        UUID mediaUuid = UUID.randomUUID();
        UUID pageUuid = UUID.randomUUID();

        JsonNode content = JsonUtil.parse("""
                {
                  "heroImage": { "type": "MEDIA_REF", "uuid": "%s" },
                  "related":   { "type": "ASSET_REF", "uuid": "%s" }
                }
                """.formatted(mediaUuid, pageUuid));

        assertThat(service.extract(content, "content")).containsExactly(
                new ExtractedReference(ReferenceKind.MEDIA_REF, mediaUuid, "content.heroImage"),
                new ExtractedReference(ReferenceKind.CONTENT_REF, pageUuid, "content.related"));
    }

    @Test
    void mapsLinkKinds() {
        UUID pageUuid = UUID.randomUUID();
        UUID mediaUuid = UUID.randomUUID();

        JsonNode content = JsonUtil.parse("""
                {
                  "internalLink": { "kind": "INTERNAL", "uuid": "%s" },
                  "mediaLink":    { "kind": "MEDIA",    "uuid": "%s" },
                  "externalLink": { "kind": "EXTERNAL", "url": "https://example.com" }
                }
                """.formatted(pageUuid, mediaUuid));

        assertThat(service.extract(content, "content")).extracting(ExtractedReference::kind)
                .containsExactly(ReferenceKind.CONTENT_REF, ReferenceKind.MEDIA_REF);
    }

    @Test
    void skipsMalformedUuids() {
        JsonNode content = JsonUtil.parse("{\"heroImage\":{\"type\":\"MEDIA_REF\",\"uuid\":\"not-a-uuid\"}}");

        assertThat(service.extract(content, "content")).isEmpty();
    }

    @Test
    void keepsReferencesAtDistinctPathsToSameTarget() {
        UUID mediaUuid = UUID.randomUUID();

        JsonNode content = JsonUtil.parse("""
                { "a": { "type": "MEDIA_REF", "uuid": "%s" }, "b": { "type": "MEDIA_REF", "uuid": "%s" } }
                """.formatted(mediaUuid, mediaUuid));

        assertThat(service.extract(content, "content")).extracting(ExtractedReference::sourcePath)
                .containsExactly("content.a", "content.b");
    }

    @Test
    void extractsReferencesInsideLists() {
        UUID mediaUuid = UUID.randomUUID();

        JsonNode content = JsonUtil.parse("""
                { "gallery": [ { "type": "MEDIA_REF", "uuid": "%s" }, { "type": "MEDIA_REF", "uuid": "%s" } ] }
                """.formatted(mediaUuid, mediaUuid));

        assertThat(service.extract(content, "content")).extracting(ExtractedReference::sourcePath)
                .containsExactly("content.gallery[0]", "content.gallery[1]");
    }

    @Test
    void rootsPathsAtTheGivenPathAndFindsCatalogCards() {
        UUID mediaUuid = UUID.randomUUID();
        UUID cardTemplate = UUID.randomUUID();

        JsonNode content = JsonUtil.parse("""
                {
                  "heroImage": { "type": "MEDIA_REF", "uuid": "%s" },
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
    }

    @Test
    void extractOfMissingContentIsEmpty() {
        assertThat(service.extract(null, "content")).isEmpty();
        assertThat(service.extract(JsonUtil.parse("null"), "content")).isEmpty();
    }
}
