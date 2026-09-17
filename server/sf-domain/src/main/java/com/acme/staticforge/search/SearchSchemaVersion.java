package com.acme.staticforge.search;

/**
 * The version of the index's document model (M23.2.2), stored in every commit next to the revision stamp. Bump it
 * whenever fields, analyzers or extractors change what a document holds: an index written with another version is
 * rebuilt on the next sync.
 */
public final class SearchSchemaVersion {

    public static final int CURRENT = 1;

    private SearchSchemaVersion() {}
}
