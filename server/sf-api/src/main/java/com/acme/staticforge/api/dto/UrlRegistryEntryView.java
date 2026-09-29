package com.acme.staticforge.api.dto;

import java.time.Instant;
import java.util.UUID;

/**
 * One URL registry row for the settings UI and the asset editors (`M8.2.4`, every target since M32.7). The target's
 * facts are joined in so the UI needs no call per row.
 *
 * @param channelKey the channel; {@code ""} for media, which is channel-independent
 * @param locale the language key; {@code ""} for a row without a language
 * @param targetType {@code PAGE}, {@code MEDIA} or {@code FOLDER}
 * @param targetLabel the target's display name (its uid when it has none); {@code null} for an unknown asset
 * @param targetUid the target's uid; {@code null} for an unknown asset
 * @param targetPath the stored path of the folder the target lives in (a folder: its own); {@code null} when unknown
 * @param targetDeleted whether the target's draft is deleted (a row kept for its override)
 * @param variant a media variant's name; {@code ""} otherwise
 * @param pageNumber the page number of a paginated page's output; {@code 1} otherwise
 */
public record UrlRegistryEntryView(
        Long id,
        String channelKey,
        String area,
        String locale,
        String targetType,
        UUID targetUuid,
        String targetLabel,
        String targetUid,
        String targetPath,
        boolean targetDeleted,
        String variant,
        int pageNumber,
        String url,
        boolean overridden,
        Instant assignedAt,
        long assignedRevision) {}
