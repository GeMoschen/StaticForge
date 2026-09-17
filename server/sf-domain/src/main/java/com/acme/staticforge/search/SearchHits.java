package com.acme.staticforge.search;

import com.acme.staticforge.asset.AssetType;
import java.util.List;
import java.util.Map;

/**
 * One page of search results (M23.3.1).
 *
 * @param hits the requested page, best first
 * @param totalHits every hit of the query, filters applied
 * @param typeCounts hits per type with every filter but the type filter applied (drill-sideways), so the counts of
 *     unselected types stay visible
 */
public record SearchHits(List<SearchHit> hits, long totalHits, Map<AssetType, Long> typeCounts) {

    public SearchHits {
        hits = List.copyOf(hits);
        typeCounts = Map.copyOf(typeCounts);
    }
}
