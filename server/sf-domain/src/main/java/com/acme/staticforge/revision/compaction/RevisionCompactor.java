package com.acme.staticforge.revision.compaction;

import com.acme.staticforge.housekeeping.JobContext;
import com.acme.staticforge.revision.RevisionAware;
import com.acme.staticforge.revision.compaction.CompactionPlanner.Absorption;
import com.acme.staticforge.revision.compaction.CompactionPlanner.Protection;
import com.acme.staticforge.revision.compaction.CompactionPlanner.ReferencePlan;
import com.acme.staticforge.revision.compaction.CompactionPlanner.ReferenceRow;
import com.acme.staticforge.revision.compaction.CompactionPlanner.VersionRow;
import com.acme.staticforge.scheduler.ActionStatus;
import com.acme.staticforge.scheduler.ScheduledAction;
import com.acme.staticforge.scheduler.ScheduledActionRepository;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.persistence.EntityManager;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.Collection;
import java.util.Collections;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeSet;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * Revision compaction (M29.4.2, spec §7.7, epic decision 13): collapses a project's old versions to the last version
 * of each day, keeping every version a release, a retained build or a pending schedule depends on. <strong>This is
 * the only code path that rewrites history</strong>, and the only one that decreases a {@code valid_from_revision}
 * (the JPA mappings make that column non-updatable; {@code RevisionHistoryRewriteGuardTest} fails if another class
 * starts to write it).
 *
 * <p>What goes and what absorbs it is decided by {@link CompactionPlanner}. Per removed run, this class deletes the
 * versions, moves the survivor's {@code valid_from_revision} back (recording the first value in
 * {@code original_valid_from}), rewrites the asset's {@code asset_reference} rows so the edges at every revision still
 * equal the version valid there, flags the revisions whose own changes were absorbed ({@code revision.compacted}) and
 * advances {@code project.compacted_through}. It writes no revision. Uid history is left alone: a uid change writes no
 * version ({@code asset_uid_history} is per revision, not per version), so absorbing versions can't change it.
 *
 * <p><strong>Protected versions</strong> (never removed): (a) every version an {@code asset_release} row points at,
 * open or closed, any locale; (b) every version valid at a revision of a build still on disk
 * ({@link RetainedBuildRevisions}) or of a build queued or running now; (c) every version pinned by a
 * {@code PENDING}/{@code RUNNING} scheduled action; (d) the last version of each day. (a), (c) and the running builds
 * are read per batch, under the lock, so a release or a schedule committed meanwhile is seen.
 *
 * <p><strong>Locking.</strong> The work runs in batches of at most {@code batchAssets} assets, one short transaction
 * each. A batch first locks the project's {@code project_revision_counter} row ({@code SELECT … FOR UPDATE}), the row
 * every revision allocation locks, so no save of the project interleaves with it and no reader sees a half-rewritten
 * asset. Open versions are never touched, and closed versions are never written by saves. Cancellation is checked
 * between batches.
 *
 * <p>A <strong>dry run</strong> plans exactly the same way and writes nothing: its counts equal those of a real run
 * that follows while nothing changed in between.
 */
@Service
@RevisionAware
public class RevisionCompactor {

    /** Assets per batch (one transaction holding the project's revision lock). */
    public static final int DEFAULT_BATCH_ASSETS = 200;

    private static final int IN_CHUNK = 500;

    private final JdbcTemplate jdbc;
    private final EntityManager entityManager;
    private final ScheduledActionRepository scheduledActions;
    private final RetainedBuildRevisions retainedBuilds;
    private final ObjectMapper mapper;
    private final TransactionTemplate writeTx;
    private final TransactionTemplate readTx;

    public RevisionCompactor(
            JdbcTemplate jdbc,
            EntityManager entityManager,
            ScheduledActionRepository scheduledActions,
            RetainedBuildRevisions retainedBuilds,
            ObjectMapper mapper,
            PlatformTransactionManager transactionManager) {
        this.jdbc = jdbc;
        this.entityManager = entityManager;
        this.scheduledActions = scheduledActions;
        this.retainedBuilds = retainedBuilds;
        this.mapper = mapper;
        this.writeTx = new TransactionTemplate(transactionManager);
        this.writeTx.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
        this.readTx = new TransactionTemplate(transactionManager);
        this.readTx.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
        this.readTx.setReadOnly(true);
    }

    /** {@link #compact(long, Instant, boolean, int, JobContext)} with {@value #DEFAULT_BATCH_ASSETS} assets per batch. */
    public CompactionResult compact(long projectId, Instant cutoff, boolean dryRun, JobContext ctx) {
        return compact(projectId, cutoff, dryRun, DEFAULT_BATCH_ASSETS, ctx);
    }

    /**
     * Compacts {@code projectId}'s versions of revisions before {@code cutoff}. Call it outside a transaction.
     *
     * @param ctx the job run, for cancellation and progress; {@code null} outside a job (the estimate)
     */
    public CompactionResult compact(long projectId, Instant cutoff, boolean dryRun, int batchAssets, JobContext ctx) {
        if (batchAssets < 1) {
            throw new IllegalArgumentException("batchAssets must be at least 1");
        }
        Set<Long> retained = new TreeSet<>(retainedBuilds.revisionsFor(projectId));
        long inWindow = readTx.execute(status -> countInWindow(projectId, cutoff));
        List<Long> assets = readTx.execute(status -> candidateAssets(projectId, cutoff));
        Long processedThrough = readTx.execute(status -> newestRevisionBefore(projectId, cutoff));

        Totals totals = new Totals();
        for (int from = 0; from < assets.size(); from += batchAssets) {
            if (ctx != null) {
                ctx.checkCancelled();
                ctx.progress("Project " + projectId + ": assets " + (from + 1) + "–"
                        + Math.min(from + batchAssets, assets.size()) + " of " + assets.size());
            }
            List<Long> batch = assets.subList(from, Math.min(from + batchAssets, assets.size()));
            TransactionTemplate tx = dryRun ? readTx : writeTx;
            tx.executeWithoutResult(status -> runBatch(projectId, batch, cutoff, retained, dryRun, processedThrough, totals));
        }
        long marked;
        if (dryRun) {
            marked = readTx.execute(status -> countUnmarked(projectId, totals.revisionsToMark));
        } else {
            marked = totals.revisionsMarked;
            if (processedThrough != null) {
                writeTx.executeWithoutResult(status -> advanceCompactedThrough(projectId, processedThrough));
            }
        }
        return new CompactionResult(
                inWindow, totals.assetsTouched, totals.versionsRemoved, totals.referencesRewritten, marked,
                totals.bytesFreed, totals.sample);
    }

    // ------------------------------------------------------------------
    // One batch
    // ------------------------------------------------------------------

    private void runBatch(
            long projectId,
            List<Long> assetIds,
            Instant cutoff,
            Set<Long> retained,
            boolean dryRun,
            Long processedThrough,
            Totals totals) {
        if (!dryRun) {
            lockRevisionCounter(projectId);
        }
        Map<Long, List<VersionRow>> versions = new LinkedHashMap<>();
        Map<Long, UUID> uuids = new LinkedHashMap<>();
        loadVersions(assetIds, versions, uuids);

        TreeSet<Long> protectedRevisions = new TreeSet<>(retained);
        protectedRevisions.addAll(activeRunRevisions(projectId));
        Set<Long> protectedIds = new HashSet<>(releasedVersionIds(assetIds));
        protectedIds.addAll(pinnedVersionIds(projectId));
        Protection protection = new Protection(protectedIds, protectedRevisions);

        Set<Long> batchMarks = new TreeSet<>();
        boolean changed = false;
        for (Map.Entry<Long, List<VersionRow>> entry : versions.entrySet()) {
            List<Absorption> absorptions = CompactionPlanner.plan(entry.getValue(), cutoff, protection);
            if (absorptions.isEmpty()) {
                continue;
            }
            long assetId = entry.getKey();
            ReferencePlan references = CompactionPlanner.planReferences(referenceRows(assetId), absorptions);
            List<Long> removed = new ArrayList<>();
            for (Absorption absorption : absorptions) {
                for (VersionRow version : absorption.removed()) {
                    removed.add(version.id());
                    batchMarks.add(version.validFrom());
                    batchMarks.add(version.changeRevision());
                    totals.sample(uuids.get(assetId) + "@r" + version.changeRevision());
                }
            }
            totals.assetsTouched++;
            totals.versionsRemoved += removed.size();
            totals.referencesRewritten += references.size();
            totals.bytesFreed += payloadBytes(removed);
            if (!dryRun) {
                apply(assetId, absorptions, removed, references);
                changed = true;
            }
        }
        totals.revisionsToMark.addAll(batchMarks);
        if (changed) {
            totals.revisionsMarked += markRevisions(projectId, batchMarks);
            if (processedThrough != null) {
                advanceCompactedThrough(projectId, processedThrough);
            }
        }
    }

    /** Writes one asset's plan: references first, then the versions (removed rows go before survivors move). */
    private void apply(long assetId, List<Absorption> absorptions, List<Long> removed, ReferencePlan references) {
        for (List<Long> chunk : chunks(references.deleted())) {
            jdbc.update("DELETE FROM asset_reference WHERE from_asset_id = ? AND id IN (" + placeholders(chunk.size()) + ")",
                    args(assetId, chunk));
        }
        for (ReferenceRow row : references.updated()) {
            int n = jdbc.update(
                    "UPDATE asset_reference SET valid_from_revision = ?, valid_to_revision = ? WHERE id = ? AND from_asset_id = ?",
                    row.validFrom(), row.validTo(), row.id(), assetId);
            requireOne(n, "reference row " + row.id());
        }
        for (List<Long> chunk : chunks(removed)) {
            int n = jdbc.update(
                    "DELETE FROM asset_version WHERE asset_id = ? AND valid_to_revision IS NOT NULL AND id IN ("
                            + placeholders(chunk.size()) + ")",
                    args(assetId, chunk));
            if (n != chunk.size()) {
                throw new IllegalStateException("Compaction of asset " + assetId + " expected to remove " + chunk.size()
                        + " versions, removed " + n);
            }
        }
        for (Absorption absorption : absorptions) {
            VersionRow survivor = absorption.survivor();
            int n = jdbc.update(
                    "UPDATE asset_version SET valid_from_revision = ?, original_valid_from = ? "
                            + "WHERE id = ? AND asset_id = ? AND valid_from_revision = ? AND valid_to_revision IS NOT NULL",
                    absorption.newValidFrom(), absorption.survivorOriginalValidFrom(), survivor.id(), assetId,
                    survivor.validFrom());
            requireOne(n, "survivor version " + survivor.id());
        }
    }

    // ------------------------------------------------------------------
    // Reads
    // ------------------------------------------------------------------

    /** Every closed version of the project whose revision is before {@code cutoff}. */
    private long countInWindow(long projectId, Instant cutoff) {
        Long n = jdbc.queryForObject("""
                SELECT COUNT(*) FROM asset_version v
                JOIN asset a ON a.id = v.asset_id
                JOIN revision r ON r.project_id = a.project_id AND r.revision_id = v.valid_from_revision
                WHERE a.project_id = ? AND v.valid_to_revision IS NOT NULL AND r.created_at < ?
                """, Long.class, projectId, utc(cutoff));
        return n == null ? 0 : n;
    }

    /**
     * Assets with at least two versions in the window, in id order: a version is only ever removed into a later
     * version of the same day that is itself in the window, so an asset with fewer can't lose any.
     */
    private List<Long> candidateAssets(long projectId, Instant cutoff) {
        return jdbc.queryForList("""
                SELECT v.asset_id FROM asset_version v
                JOIN asset a ON a.id = v.asset_id
                JOIN revision r ON r.project_id = a.project_id AND r.revision_id = v.valid_from_revision
                WHERE a.project_id = ? AND v.valid_to_revision IS NOT NULL AND r.created_at < ?
                GROUP BY v.asset_id
                HAVING COUNT(*) > 1
                ORDER BY v.asset_id
                """, Long.class, projectId, utc(cutoff));
    }

    /** The newest revision before {@code cutoff}: what a complete run has processed. */
    private Long newestRevisionBefore(long projectId, Instant cutoff) {
        return jdbc.queryForObject(
                "SELECT MAX(revision_id) FROM revision WHERE project_id = ? AND created_at < ?",
                Long.class, projectId, utc(cutoff));
    }

    /**
     * Every version of {@code assetIds} with the {@code created_at} of its revision (a missing revision row reads as
     * {@code null}: never in the window). All versions, not only candidates: the last version of a day and the next
     * survivor may lie outside the window.
     */
    private void loadVersions(List<Long> assetIds, Map<Long, List<VersionRow>> versions, Map<Long, UUID> uuids) {
        jdbc.query("""
                SELECT v.id, v.asset_id, a.uuid, v.valid_from_revision, v.valid_to_revision, v.original_valid_from,
                       r.created_at
                FROM asset_version v
                JOIN asset a ON a.id = v.asset_id
                LEFT JOIN revision r ON r.project_id = a.project_id AND r.revision_id = v.valid_from_revision
                WHERE v.asset_id IN (""" + placeholders(assetIds.size()) + ") ORDER BY v.asset_id, v.valid_from_revision",
                rs -> {
                    long assetId = rs.getLong("asset_id");
                    OffsetDateTime created = rs.getObject("created_at", OffsetDateTime.class);
                    versions.computeIfAbsent(assetId, id -> new ArrayList<>()).add(new VersionRow(
                            rs.getLong("id"),
                            assetId,
                            rs.getLong("valid_from_revision"),
                            (Long) rs.getObject("valid_to_revision", Long.class),
                            (Long) rs.getObject("original_valid_from", Long.class),
                            created == null ? null : created.toInstant()));
                    uuids.putIfAbsent(assetId, rs.getObject("uuid", UUID.class));
                },
                assetIds.toArray());
    }

    private List<ReferenceRow> referenceRows(long assetId) {
        return jdbc.query(
                "SELECT id, valid_from_revision, valid_to_revision FROM asset_reference WHERE from_asset_id = ?",
                (rs, i) -> new ReferenceRow(
                        rs.getLong("id"), rs.getLong("valid_from_revision"), rs.getObject("valid_to_revision", Long.class)),
                assetId);
    }

    /** (a): every version a release row of these assets points at, open or closed, any locale. */
    private List<Long> releasedVersionIds(List<Long> assetIds) {
        return jdbc.queryForList(
                "SELECT DISTINCT released_version_id FROM asset_release WHERE asset_id IN ("
                        + placeholders(assetIds.size()) + ")",
                Long.class, assetIds.toArray());
    }

    /** (c): the versions pinned by the project's pending and running scheduled actions (any {@code pinnedVersionId}). */
    private Set<Long> pinnedVersionIds(long projectId) {
        Set<Long> pinned = new HashSet<>();
        for (ScheduledAction action : scheduledActions.findByProjectIdAndStatusInOrderById(
                projectId, List.of(ActionStatus.PENDING, ActionStatus.RUNNING))) {
            collectPins(action.getParams(), pinned);
        }
        return pinned;
    }

    private static void collectPins(JsonNode node, Set<Long> pinned) {
        if (node == null) {
            return;
        }
        if (node.isObject()) {
            node.fields().forEachRemaining(field -> {
                if (field.getKey().equals("pinnedVersionId") && field.getValue().canConvertToLong()
                        && field.getValue().isIntegralNumber()) {
                    pinned.add(field.getValue().asLong());
                } else {
                    collectPins(field.getValue(), pinned);
                }
            });
        } else if (node.isArray()) {
            node.forEach(child -> collectPins(child, pinned));
        }
    }

    /** (b), live part: the revisions of the project's queued and running builds. */
    private List<Long> activeRunRevisions(long projectId) {
        return jdbc.queryForList(
                "SELECT revision_id FROM generation_run WHERE project_id = ? AND status IN ('QUEUED', 'RUNNING') "
                        + "AND revision_id IS NOT NULL",
                Long.class, projectId);
    }

    /** The serialized payload size of {@code versionIds}: the estimate of what removing them frees. */
    private long payloadBytes(List<Long> versionIds) {
        long bytes = 0;
        for (List<Long> chunk : chunks(versionIds)) {
            List<JsonNode> payloads = entityManager
                    .createQuery("SELECT v.payload FROM AssetVersion v WHERE v.id IN :ids", JsonNode.class)
                    .setParameter("ids", chunk)
                    .getResultList();
            for (JsonNode payload : payloads) {
                try {
                    bytes += payload == null ? 0 : mapper.writeValueAsBytes(payload).length;
                } catch (JsonProcessingException e) {
                    throw new IllegalStateException("Unreadable version payload", e);
                }
            }
        }
        return bytes;
    }

    private long countUnmarked(long projectId, Collection<Long> revisions) {
        long n = 0;
        for (List<Long> chunk : chunks(List.copyOf(revisions))) {
            Long count = jdbc.queryForObject(
                    "SELECT COUNT(*) FROM revision WHERE project_id = ? AND compacted = FALSE AND revision_id IN ("
                            + placeholders(chunk.size()) + ")",
                    Long.class, args(projectId, chunk));
            n += count == null ? 0 : count;
        }
        return n;
    }

    // ------------------------------------------------------------------
    // Writes
    // ------------------------------------------------------------------

    /** The row every revision allocation of the project locks (JdbcRevisionCounterRepository). */
    private void lockRevisionCounter(long projectId) {
        jdbc.queryForObject(
                "SELECT next_revision FROM project_revision_counter WHERE project_id = ? FOR UPDATE", Long.class, projectId);
    }

    private int markRevisions(long projectId, Collection<Long> revisions) {
        int n = 0;
        for (List<Long> chunk : chunks(List.copyOf(revisions))) {
            n += jdbc.update(
                    "UPDATE revision SET compacted = TRUE WHERE project_id = ? AND compacted = FALSE AND revision_id IN ("
                            + placeholders(chunk.size()) + ")",
                    args(projectId, chunk));
        }
        return n;
    }

    private void advanceCompactedThrough(long projectId, long revision) {
        jdbc.update(
                "UPDATE project SET compacted_through = ? WHERE id = ? AND (compacted_through IS NULL OR compacted_through < ?)",
                revision, projectId, revision);
    }

    // ------------------------------------------------------------------
    // Helpers
    // ------------------------------------------------------------------

    private static void requireOne(int updated, String what) {
        if (updated != 1) {
            throw new IllegalStateException("Compaction expected to update " + what + " once, updated " + updated);
        }
    }

    private static List<List<Long>> chunks(List<Long> ids) {
        if (ids.isEmpty()) {
            return List.of();
        }
        List<List<Long>> out = new ArrayList<>();
        for (int i = 0; i < ids.size(); i += IN_CHUNK) {
            out.add(ids.subList(i, Math.min(i + IN_CHUNK, ids.size())));
        }
        return out;
    }

    private static String placeholders(int n) {
        return String.join(", ", Collections.nCopies(n, "?"));
    }

    private static Object[] args(long first, List<Long> rest) {
        Object[] out = new Object[rest.size() + 1];
        out[0] = first;
        for (int i = 0; i < rest.size(); i++) {
            out[i + 1] = rest.get(i);
        }
        return out;
    }

    private static OffsetDateTime utc(Instant instant) {
        return OffsetDateTime.ofInstant(instant, ZoneOffset.UTC);
    }

    /** Counters summed over the batches of one project. */
    private static final class Totals {
        long assetsTouched;
        long versionsRemoved;
        long referencesRewritten;
        long bytesFreed;
        long revisionsMarked;
        final Set<Long> revisionsToMark = new TreeSet<>();
        final List<String> sample = new ArrayList<>();

        void sample(String item) {
            if (sample.size() < JobContext.MAX_SAMPLE) {
                sample.add(item);
            }
        }
    }
}
