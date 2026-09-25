package com.acme.staticforge.release;

/**
 * The release status of one editorial (asset, locale) (M27.1.1, epic decision 6). Compares the draft — the asset's
 * open version and uid — with the released pointer through their {@link LocaleProjection locale projections}.
 */
public enum ReleaseStatus {
    /** Never released in this locale. */
    NEW,
    /** Released, and the draft looks the same in this locale. */
    PUBLISHED,
    /** Released, and the draft differs in this locale (content, structure, uid, folder or deletion aside). */
    CHANGED,
    /** Was released in this locale, is not any more; the draft exists. */
    UNPUBLISHED,
    /** The draft is deleted while the released version is still live in this locale. */
    DELETION_PENDING;

    /** {@code true} for every status the Changes view lists: everything but {@link #PUBLISHED}. */
    public boolean isPending() {
        return this != PUBLISHED;
    }
}
