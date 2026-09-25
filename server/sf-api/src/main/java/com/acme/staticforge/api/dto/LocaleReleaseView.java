package com.acme.staticforge.api.dto;

import java.time.Instant;

/**
 * The release status of an asset in one locale (M27.1.3): {@code NEW}, {@code PUBLISHED}, {@code CHANGED},
 * {@code UNPUBLISHED} or {@code DELETION_PENDING}, with the pointer it was computed from ({@code null}s when nothing
 * is released in that locale). Assets carry a map of these keyed by locale ({@code ""} for "every locale").
 */
public record LocaleReleaseView(String status, Long releasedRevision, Instant releasedAt, Long releasedBy) {}
