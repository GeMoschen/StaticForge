package com.acme.staticforge.api.dto;

import java.time.Instant;

/**
 * One project of the admin projects overview (M26). {@code headRevision}/{@code lastChangeAt} are the project's newest
 * revision and its time.
 */
public record AdminProjectRow(
        String key,
        String name,
        String description,
        boolean archived,
        Instant createdAt,
        long memberCount,
        Long headRevision,
        Instant lastChangeAt) {}
