package com.acme.staticforge.revision;

import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.domain.Pageable;

/**
 * The single gate through which every revision is created (spec §21.2, §21.3). All
 * mutating services {@code allocate} a revision before touching the asset version rows.
 */
public interface RevisionService {

    /** Allocates a new revision id, records the {@link Revision} row, and returns it. */
    Revision allocate(long projectId, ChangeType type, String comment, Long userId);

    /** Appends a touched-asset entry to the revision's denormalized summary. */
    void appendSummary(long projectId, long revisionId, AssetChange change);

    List<Revision> findRecent(long projectId, Pageable pageable);

    /**
     * Revision spine with optional filters (spec §20.2): {@code since} returns revisions strictly
     * newer than the cursor (incremental live update), {@code userId} restricts to one author, and
     * {@code assetUuid} to revisions whose {@code summary} touched that asset.
     */
    List<Revision> findRecent(long projectId, Long since, Long userId, UUID assetUuid, Pageable pageable);

    Optional<Revision> find(long projectId, long revisionId);
}
