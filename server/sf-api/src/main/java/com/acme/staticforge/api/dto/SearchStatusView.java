package com.acme.staticforge.api.dto;

import java.time.Instant;

/**
 * {@code GET /search/status} (M23.2.2).
 *
 * @param indexedRevision the revision the index is complete up to; {@code null} while there is no usable index yet
 * @param state {@code READY}, {@code CATCHING_UP}, {@code REBUILDING} or {@code UNAVAILABLE}
 * @param lastRebuildAt when this instance last finished a full rebuild, or {@code null}
 */
public record SearchStatusView(Long indexedRevision, long latestRevision, long lag, String state, Instant lastRebuildAt) {}
