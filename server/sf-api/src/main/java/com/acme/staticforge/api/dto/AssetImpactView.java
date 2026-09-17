package com.acme.staticforge.api.dto;

import java.util.Map;
import java.util.UUID;

/**
 * What would rebuild if an asset changed (M22.2.2), as of the current revision: an upper bound, since a real edit may
 * matter to fewer readers.
 *
 * @param entryCount outputs that would rebuild (pages × channels, plus processed media)
 * @param pageCount distinct pages among them
 * @param byFirstEdge entry counts by the first edge of their chain ({@code NONE} for the asset itself)
 */
public record AssetImpactView(
        AssetRef asset,
        long revision,
        int entryCount,
        int pageCount,
        Map<String, Integer> byFirstEdge,
        GenerationPlanView.EntryPage entries) {

    public record AssetRef(UUID uuid, String type, String uid) {}
}
