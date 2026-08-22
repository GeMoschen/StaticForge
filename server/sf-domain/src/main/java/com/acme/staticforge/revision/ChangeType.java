package com.acme.staticforge.revision;

/** Kind of atomic change recorded on a revision (spec §7.2). */
public enum ChangeType {
    CREATE,
    UPDATE,
    DELETE,
    RESTORE,
    MOVE,
    RENAME,
    UID_CHANGE,
    BULK,
    IMPORT,
    PUBLISH
}
