package com.acme.staticforge.api.dto;

import java.util.UUID;

/**
 * One item of a scheduled release or unpublish (M27.4.4): the asset as it is now ({@code uid} {@code null} when it is
 * gone), the locale key ({@code ""} = every locale), the pinned version, whether the draft changed since it was
 * scheduled ({@code null} unless pinned) and its current release status.
 */
public record ScheduleItemView(
        UUID assetUuid,
        String assetType,
        String uid,
        String displayName,
        String locale,
        Long pinnedVersionId,
        Boolean draftChangedSinceScheduled,
        String status) {}
