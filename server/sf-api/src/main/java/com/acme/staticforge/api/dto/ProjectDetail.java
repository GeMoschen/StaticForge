package com.acme.staticforge.api.dto;

import java.time.Instant;
import java.util.List;

/**
 * Full project representation (spec §20.2). {@code allowedMimeTypes} is empty when the project uses the instance-wide
 * default. {@code publishPolicy} is what the project gives its editors (M28); {@code permissions} are the caller's
 * effective publish permissions, in declaration order — clients show publishing controls from these, never from the
 * role (epic decision 12). {@code compactedThrough} is the newest revision revision compaction has processed (M29.4.3);
 * {@code null} when the project was never compacted — reads at later revisions are never compacted.
 * {@code codeHighlighting} are the project's code highlighting overrides (M33 follow-up), empty maps when none.
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
        List<String> permissions,
        Long compactedThrough,
        CodeHighlightingView codeHighlighting) {}
