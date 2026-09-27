package com.acme.staticforge.api.dto;

import java.util.List;

/**
 * Result of a project import (spec §26.5); {@code releasedCount} (M27.5.1): release pointers opened, one per asset and
 * locale. M27.8.1: {@code importedScheduleCount} schedules created, {@code updatedScheduleCount} open schedules
 * replaced, and {@code scheduleWarnings} — what happened to the archive's schedules, which can differ from the
 * analysis. M30.4.1: {@code importedRedirectCount} redirects added and {@code redirectWarnings} — the archive's
 * redirects left out ({@code REDIRECT_SOURCE_EXISTS}, {@code REDIRECT_INVALID}).
 */
public record ImportResultView(
        String sourceProjectKey, int importedAssetCount, int updatedAssetCount, int importedBlobCount, int releasedCount,
        int importedScheduleCount, int updatedScheduleCount, List<ImportConflictView> scheduleWarnings,
        int importedRedirectCount, List<ImportConflictView> redirectWarnings) {}
