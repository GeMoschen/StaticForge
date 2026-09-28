package com.acme.staticforge.exportimport;

import java.util.List;

/**
 * The full set of conflicts found while analyzing an import archive against a target project.
 *
 * @param releaseState whether the archive carries release state (protocol {@code >= 8}, M27.5.1)
 * @param releaseMode the release mode the import applies: the requested one, or {@link ReleaseMode#DRAFT} for an
 *     archive without release state
 * @param scheduleCount the number of schedules in the archive (M27.8.1), whether or not they are imported
 * @param redirectCount the number of redirects the import reads from the archive (M30.4.1, protocol {@code >= 10};
 *     {@code 0} for an older archive), whether or not they are imported
 */
public record ConflictReport(
        List<ImportConflict> conflicts, boolean releaseState, ReleaseMode releaseMode, int scheduleCount,
        int redirectCount) {

    /** A report about an archive whose release state doesn't matter (an unreadable or rejected one). */
    public ConflictReport(List<ImportConflict> conflicts) {
        this(conflicts, false, ReleaseMode.DRAFT, 0, 0);
    }

    /**
     * {@code true} iff any entry is {@link ConflictSeverity#BLOCKING} — including a conflict that only
     * rejects its own asset ({@link ConflictType#rejectsAssetOnly()}); see {@link #blocksImport()}.
     */
    public boolean hasBlocking() {
        return conflicts.stream().anyMatch(c -> c.severity() == ConflictSeverity.BLOCKING);
    }

    /**
     * {@code true} iff any entry refuses the whole import. {@code false} with {@link #hasBlocking()} {@code
     * true} means the import proceeds without the rejected assets (M25: records outside a record set).
     */
    public boolean blocksImport() {
        return conflicts.stream().anyMatch(ImportConflict::blocksImport);
    }
}
