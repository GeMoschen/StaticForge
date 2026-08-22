package com.acme.staticforge.api.dto;

import java.time.Instant;

/** Full project representation (spec §20.2). */
public record ProjectDetail(
        String key,
        String name,
        String description,
        boolean archived,
        Instant createdAt,
        Long createdBy) {}
