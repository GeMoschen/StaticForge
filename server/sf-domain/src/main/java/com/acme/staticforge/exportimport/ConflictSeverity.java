package com.acme.staticforge.exportimport;

/**
 * How strongly an {@link ImportConflict} should be treated by callers: whether it must
 * block a commit, or is merely informational (see {@link ConflictType} for the mapping).
 */
public enum ConflictSeverity {
    /** The import cannot proceed while this conflict is present. */
    BLOCKING,
    /** The import can proceed; the affected element will be skipped or otherwise handled safely. */
    WARNING
}
