package com.acme.staticforge.api.dto;

import java.util.List;

/**
 * Client-facing conflict report returned by the analyze-import endpoint (M10.2.3). {@code hasBlocking}: any
 * {@code BLOCKING} conflict; {@code blocksImport} (M25): any conflict that refuses the whole import — when it
 * is {@code false}, committing imports everything except the assets the blocking conflicts reject.
 *
 * <p>{@code releaseState} (M27.5.1): whether the archive carries release state (protocol {@code >= 8});
 * {@code releaseMode} ({@code KEEP} | {@code DRAFT}): the mode the import applies — the requested one, or {@code
 * DRAFT} for an archive without release state, which also lists an {@code INFO} entry {@code
 * ARCHIVE_WITHOUT_RELEASE_STATE}.
 *
 * <p>{@code scheduleCount} (M27.8.1): the schedules the archive carries, whether or not the import brings them.
 *
 * <p>{@code redirectCount} (M30.4.1): the redirects the import reads from the archive (protocol {@code >= 10}; 0 for
 * an older one), whether or not they are imported.
 *
 * <p>{@code urlCount} (M32.6): the URL registry rows the import reads from the archive (protocol {@code >= 11}; 0 for
 * an older one), whether or not they are imported.
 */
public record ConflictReportView(
        List<ImportConflictView> conflicts, boolean hasBlocking, boolean blocksImport, boolean releaseState,
        String releaseMode, int scheduleCount, int redirectCount, int urlCount) {}
