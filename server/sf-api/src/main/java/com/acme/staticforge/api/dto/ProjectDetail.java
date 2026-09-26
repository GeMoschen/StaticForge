package com.acme.staticforge.api.dto;

import java.time.Instant;
import java.util.List;

/**
 * Full project representation (spec §20.2). {@code allowedMimeTypes} is empty when the project uses the instance-wide
 * default. {@code publishPolicy} is what the project gives its editors (M28); {@code permissions} are the caller's
 * effective publish permissions, in declaration order — clients show publishing controls from these, never from the
 * role (epic decision 12).
 */
public record ProjectDetail(
        String key,
        String name,
        String description,
        boolean archived,
        Instant createdAt,
        Long createdBy,
        List<String> allowedMimeTypes,
        PublishPolicyView publishPolicy,
        List<String> permissions) {}
