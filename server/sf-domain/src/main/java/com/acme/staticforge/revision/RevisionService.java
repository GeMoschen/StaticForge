package com.acme.staticforge.revision;

import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;

/**
 * The single gate through which every revision is created (spec §21.2, §21.3). All
 * mutating services {@code allocate} a revision before touching the asset version rows.
 */
public interface RevisionService {

    /**
     * Allocates a new revision id, records the {@link Revision} row, and returns it. Refuses an archived project with
     * {@code 409 SF-DOM-0141} (M26): the central read-only guard for every write that allocates a revision.
     */
    Revision allocate(long projectId, ChangeType type, String comment, Long userId);

    /**
     * {@link #allocate} without the archived check, for the writes an archived project must still accept (M26):
     * archiving and unarchiving it, and removing the memberships of an account that is being deleted.
     */
    Revision allocateEvenIfArchived(long projectId, ChangeType type, String comment, Long userId);

    /**
     * Allocates a new revision id exactly like {@link #allocate}, named to signal that the
     * caller intends it to be reused across several subsequent nested service calls (spec
     * §7.1's compound-revision case) rather than closed after a single change. Callers build
     * a {@link RevisionContext#joining} around the returned {@link Revision} and thread it
     * into every nested call so those calls' {@link #allocateOrJoin} joins this same batch.
     */
    Revision beginBatch(long projectId, ChangeType type, String comment, Long userId);

    /**
     * Returns {@code ctx.openRevision()} unchanged when the context already carries an
     * open batch revision; otherwise allocates a fresh one exactly like {@link #allocate}.
     * The {@code type} parameter is deliberately ignored when joining an existing batch —
     * the batch's own {@link ChangeType}, fixed once at {@link #beginBatch} time, is
     * authoritative for the whole container, so a caller joining an open {@code CREATE}
     * batch with what would locally have been a {@code MOVE} does not get a second,
     * conflicting change type.
     */
    Revision allocateOrJoin(RevisionContext ctx, ChangeType type);

    /** Appends a touched-asset entry to the revision's denormalized summary. */
    void appendSummary(long projectId, long revisionId, AssetChange change);

    /**
     * Appends several touched-asset entries in one summary write — for a compound revision touching
     * many assets (M19.1.2), where one write per entry would rewrite the growing summary each time.
     */
    void appendSummaries(long projectId, long revisionId, List<AssetChange> changes);

    List<Revision> findRecent(long projectId, Pageable pageable);

    /**
     * Revision spine with optional filters (spec §20.2): {@code since} returns revisions strictly
     * newer than the cursor (incremental live update), {@code userId} restricts to one author, and
     * {@code assetUuid} to revisions whose {@code summary} touched that asset.
     */
    List<Revision> findRecent(long projectId, Long since, Long userId, UUID assetUuid, Pageable pageable);

    /**
     * Revisions of a project matching {@code filter}, newest first, one page of them with the total number of matches.
     * Every criterion is applied in the database query before paging; the page's sort is ignored. An unpaged
     * {@code pageable} returns all matches.
     */
    Page<Revision> search(long projectId, RevisionFilter filter, Pageable pageable);

    Optional<Revision> find(long projectId, long revisionId);
}
