package com.acme.staticforge.exportimport;

import java.util.List;

/** The full set of conflicts found while analyzing an import archive against a target project. */
public record ConflictReport(List<ImportConflict> conflicts) {

    /** {@code true} iff any entry is {@link ConflictSeverity#BLOCKING}. */
    public boolean hasBlocking() {
        return conflicts.stream().anyMatch(c -> c.severity() == ConflictSeverity.BLOCKING);
    }
}
