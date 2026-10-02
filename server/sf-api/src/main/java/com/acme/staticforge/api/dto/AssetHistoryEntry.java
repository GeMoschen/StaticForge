package com.acme.staticforge.api.dto;

import java.time.Instant;

/** One entry in an asset's version history; {@code changedByName} is {@code null} when the account is unknown or deleted. */
public record AssetHistoryEntry(
        long revision, String displayName, boolean deleted, Long changedBy, String changedByName, Instant changedAt) {}
