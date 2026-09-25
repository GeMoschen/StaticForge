package com.acme.staticforge.exportimport;

import java.util.List;

/**
 * The full set of conflicts found while analyzing an import archive against a target project.
 *
 * @param releaseState whether the archive carries release state (protocol {@code >= 8}, M27.5.1)
 * @param releaseMode the release mode the import applies: the requested one, or {@link ReleaseMode#DRAFT} for an
 *     archive without release state
 */
public record ConflictReport(List<ImportConflict> conflicts, boolean releaseState, ReleaseMode releaseMode) {

    /** A report about an archive whose release state doesn't matter (an unreadable or rejected one). */
    public ConflictReport(List<ImportConflict> conflicts) {
        this(conflicts, false, ReleaseMode.DRAFT);
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
