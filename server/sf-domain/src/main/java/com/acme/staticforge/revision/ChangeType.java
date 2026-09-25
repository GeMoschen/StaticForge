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
    /** Release: opens release pointers of (asset, locale) pairs at a version (M27.1.2). */
    RELEASE,
    /** Unpublish: closes release pointers; the drafts stay (M27.1.2). */
    UNPUBLISH,
    /** Discard changes: writes the released version of a locale back as a new version (M27.1.2). */
    DISCARD
}
