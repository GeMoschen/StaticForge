package com.acme.staticforge.api.dto;

import java.time.Instant;

/** One entry in an asset's version history. */
public record AssetHistoryEntry(
        long revision, String displayName, boolean deleted, Long changedBy, Instant changedAt) {}
