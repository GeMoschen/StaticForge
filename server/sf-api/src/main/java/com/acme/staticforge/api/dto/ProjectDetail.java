package com.acme.staticforge.api.dto;

import java.time.Instant;
import java.util.List;

/** Full project representation (spec §20.2). {@code allowedMimeTypes} is empty when the project uses the instance-wide default. */
public record ProjectDetail(
        String key,
        String name,
        String description,
        boolean archived,
        Instant createdAt,
        Long createdBy,
        List<String> allowedMimeTypes) {}
