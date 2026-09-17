package com.acme.staticforge.search;

import java.util.OptionalLong;
import java.util.Set;
import java.util.UUID;

/**
 * One embedded Lucene index per project (M23.1.1). Stores and queries {@link SearchDocument}s; it knows nothing about
 * payloads, revisions or transactions. The index is a disposable cache of the database: deleting its directory is
 * always safe.
 *
 * <p>Every operation on a project whose index can't be opened (its write lock is held by another instance) throws
 * the {@code 503 SF-SEARCH-0503} problem.
 */
public interface SearchIndexService {

    /** Adds the document, replacing any document with the same UUID. */
    void upsert(long projectId, SearchDocument document);

    void delete(long projectId, UUID uuid);

    void deleteAll(long projectId);

    /**
     * Commits pending changes with {@code indexedRevision} as the revision stamp, in the same Lucene commit, and makes
     * them searchable.
     *
     * @param owner identifies the database state the index was built from (the project's key and creation time), so
     *     an index left over from another database is never mistaken for a current one
     */
    void commit(long projectId, long indexedRevision, String owner);

    /** The revision stamp of the latest commit; empty when the index has none. */
    OptionalLong indexedRevision(long projectId);

    /** The state of the project's index directory, without failing on a missing or corrupt index. */
    IndexCheck check(long projectId);

    SearchHits search(long projectId, SearchQuery query);

    /**
     * Starts a full rebuild into a sibling index. Queries and writes keep using the current index until
     * {@link Rebuild#swap} replaces it.
     */
    Rebuild startRebuild(long projectId);

    /** Closes the project's writer and searchers; the next operation reopens them. */
    void close(long projectId);

    /** Projects with an open writer. */
    Set<Long> openProjects();

    /** Projects whose index couldn't be opened because its write lock is held elsewhere. */
    Set<Long> unavailableProjects();

    /** A full rebuild in progress. Not thread-safe: one rebuild is driven by one caller. */
    interface Rebuild extends AutoCloseable {

        void add(SearchDocument document);

        /**
         * Commits the rebuilt index stamped with {@code indexedRevision} and replaces the project's index with it,
         * after in-flight searches and writes on the old index have finished.
         */
        void swap(long indexedRevision, String owner);

        /** Discards the rebuild unless it was swapped. */
        @Override
        void close();
    }
}
