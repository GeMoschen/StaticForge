package com.acme.staticforge.asset.navigation;

import com.acme.staticforge.asset.AssetType;
import com.fasterxml.jackson.databind.JsonNode;
import java.util.UUID;

/**
 * A point-in-time view of a single asset as seen by {@link NavigationLookup} (spec §17,
 * `M8.1.3`). Deliberately narrow — just the fields the navigation resolver needs — so both
 * the live-repository path and the revision-pinned {@code Snapshot} path can be adapted to
 * it without leaking either data-access model into the algorithm.
 */
public record NavigationAsset(UUID uuid, AssetType type, String uid, String displayName, JsonNode payload) {}
