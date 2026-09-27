package com.acme.staticforge.api.dto;

import java.time.Instant;
import java.util.UUID;

/**
 * One redirect of the registry (M30.4.1). The target is a page ({@code toAssetUuid} + {@code toPageNumber}, with the
 * page's current display name) or a fixed {@code toPath} (an output path or an absolute URL). {@code state} and
 * {@code resolvedTarget} are computed against the default target's current build: {@code ACTIVE}, {@code SHADOWED}
 * (a page or media file lives at {@code fromPath}), {@code DANGLING} (the target page has no output in this channel
 * and locale), {@code LOOP}; both are {@code null} when nothing is published there. {@code resolvedTarget} is where the
 * redirect leads there (the target page's output path, or {@code toPath}). {@code locale} is {@code ""} in a project
 * without locales. {@code createdBy} is {@code null} for an {@code AUTO} entry, whose {@code sourceRunId} names the
 * build that detected it. {@code version} goes into {@code If-Match: "v{version}"}.
 */
public record RedirectView(
        long id,
        String channel,
        String locale,
        String fromPath,
        UUID toAssetUuid,
        Integer toPageNumber,
        String toAssetName,
        String toPath,
        String kind,
        String state,
        String resolvedTarget,
        Instant createdAt,
        Long createdBy,
        Long sourceRunId,
        Instant updatedAt,
        Long updatedBy,
        long version) {}
