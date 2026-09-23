package com.acme.staticforge.exportimport;

import java.util.List;

/** The full set of conflicts found while analyzing an import archive against a target project. */
public record ConflictReport(List<ImportConflict> conflicts) {

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
