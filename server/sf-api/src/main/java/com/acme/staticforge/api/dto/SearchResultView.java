package com.acme.staticforge.api.dto;

import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * {@code GET /search} (M23.3.1): one page of hits in the paging envelope (spec §20.1), type facet counts and the
 * revisions the index answered from. Nested records carry search-specific names because OpenAPI schemas are named
 * by simple class name.
 *
 * @param facets hit counts per type with every filter but {@code type} applied
 * @param indexedRevision the revision the index is complete up to; {@code null} while it has no usable index yet
 */
public record SearchResultView(
        List<SearchHitView> content,
        SearchPageMeta page,
        SearchFacets facets,
        Long indexedRevision,
        long latestRevision) {

    /**
     * {@code number} is zero-based. {@code totalIsLowerBound} is {@code true} when more hits exist than counted (the
     * count is exact today; the flag keeps the envelope stable if counting ever stops early).
     */
    public record SearchPageMeta(int size, int number, long totalElements, int totalPages, boolean totalIsLowerBound) {}

    public record SearchFacets(Map<String, Long> types) {}

    /**
     * @param matchedIn {@code TITLE}, {@code UID}, {@code CONTENT} or {@code SOURCE}
     * @param snippet plain text, never HTML
     * @param highlights {@code [start, end)} character offsets of the matches in {@code snippet}
     */
    public record SearchHitView(
            UUID uuid,
            String type,
            String uid,
            String displayName,
            String folderPath,
            UUID templateUuid,
            float score,
            String matchedIn,
            String snippet,
            List<SearchHighlight> highlights) {}

    public record SearchHighlight(int start, int end) {}
}
