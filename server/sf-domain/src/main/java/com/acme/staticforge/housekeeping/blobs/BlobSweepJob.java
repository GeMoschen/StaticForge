package com.acme.staticforge.housekeeping.blobs;

import com.acme.staticforge.asset.AssetVersion;
import com.acme.staticforge.asset.media.Blob;
import com.acme.staticforge.asset.media.BlobRepository;
import com.acme.staticforge.asset.media.BlobStore;
import com.acme.staticforge.asset.media.MediaFiles;
import com.acme.staticforge.asset.media.MediaVersionRepository;
import com.acme.staticforge.housekeeping.HousekeepingJob;
import com.acme.staticforge.housekeeping.JobContext;
import com.acme.staticforge.housekeeping.JobDefaults;
import com.acme.staticforge.housekeeping.JobResult;
import com.acme.staticforge.housekeeping.SettingsSpec;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.time.Duration;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.springframework.data.domain.PageRequest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowCallbackHandler;
import org.springframework.stereotype.Component;

/**
 * Job {@code blob-sweep} (M29.2.3, epic decision 8; spec §11.2): mark and sweep of the content-addressed blob store.
 *
 * <ol>
 *   <li><b>Mark.</b> Every blob referenced by any {@code asset_version} row — every revision, closed and deleted
 *       versions included — through the media payload ({@link MediaFiles#blobShas}: each file's blob and variants, and
 *       those of every per-locale file), by {@code media_variant} ({@code blob_sha} and {@code source_sha}) and by
 *       {@code generation_run.log_blob_sha}. Only {@code MEDIA} payloads reference blobs; a test pins the asset types
 *       so a new referencing type fails loudly.
 *   <li><b>Sweep rows.</b> A {@code blob} row that is unmarked and was neither created nor referenced by a write
 *       ({@code COALESCE(last_referenced_at, created_at)}) within {@code graceHours} is deleted in its own short
 *       transaction: the row is locked ({@code FOR UPDATE}, the same lock {@link com.acme.staticforge.asset.media.BlobWriter}
 *       takes to reuse it), both conditions and the {@code media_variant} references are re-checked, then the store
 *       object and the row are deleted. A write that reused the blob after the mark has moved
 *       {@code last_referenced_at} and keeps it; one that waits on the lock finds no row and stores the bytes again.
 *   <li><b>Sweep store objects.</b> The store is listed ({@link BlobStore#forEachObject}); an object without a row
 *       whose last modification is older than the grace period (orphan bytes of a failed commit or import) is claimed
 *       by inserting a placeholder row with its key — a concurrent write of the same bytes either waits for the claim
 *       or makes it fail — and deleted with the placeholder.
 *   <li><b>{@code ref_count}.</b> Every surviving row's count is set to the number of references the mark found:
 *       version rows, {@code media_variant} rows naming it as the variant blob, runs. A variant's source is kept but
 *       not counted (its versions count it). It is derived and informational; nothing deletes by it.
 * </ol>
 *
 * A dry run reports the same numbers and sample and changes nothing (no deletion, no {@code ref_count} update). Only
 * history keeps media bytes alive: deleting or replacing media frees nothing while an old version references the
 * bytes; revision compaction removes such versions and the next sweep collects what they left.
 *
 * <p>The mark holds every referenced hash in memory (a few hundred bytes per distinct blob).
 */
@Component
public class BlobSweepJob implements HousekeepingJob {

    public static final String KEY = "blob-sweep";

    static final SettingsSpec SETTINGS = SettingsSpec.builder()
            .integer("graceHours", 1, 24 * 365)
            .integer("batchSize", 1, 100_000)
            .build();

    /** Test seams between the phases; {@link #NONE} in production. */
    public interface Hooks {
        Hooks NONE = new Hooks() {};

        /** After the mark, before anything is swept. */
        default void afterMark() {}

        /** Inside the delete transaction of {@code sha256}, with its row locked (or claimed), before deleting. */
        default void beforeDelete(String sha256) {}
    }

    private final BlobSweepProperties properties;
    private final MediaVersionRepository mediaVersions;
    private final BlobRepository blobs;
    private final BlobStore store;
    private final JdbcTemplate jdbc;
    private volatile Hooks hooks = Hooks.NONE;

    public BlobSweepJob(
            BlobSweepProperties properties,
            MediaVersionRepository mediaVersions,
            BlobRepository blobs,
            BlobStore store,
            JdbcTemplate jdbc) {
        this.properties = properties;
        this.mediaVersions = mediaVersions;
        this.blobs = blobs;
        this.store = store;
        this.jdbc = jdbc;
    }

    /** Installs test seams ({@code null}: none). Tests only. */
    public void setHooks(Hooks hooks) {
        this.hooks = hooks == null ? Hooks.NONE : hooks;
    }

    @Override
    public String key() {
        return KEY;
    }

    @Override
    public String displayName() {
        return "Blob sweep";
    }

    @Override
    public String description() {
        return "Deletes stored media bytes that no version of any revision, variant or run references, after a grace"
                + " period, and recomputes blob reference counts.";
    }

    @Override
    public JobDefaults defaults() {
        return JobDefaults.of(properties, settings -> settings
                .put("graceHours", properties.getGraceHours())
                .put("batchSize", properties.getBatchSize()));
    }

    @Override
    public List<String> validateSettings(JsonNode settings) {
        return SETTINGS.validate(settings);
    }

    @Override
    public boolean supportsDryRun() {
        return true;
    }

    /** One {@code blob} row as the sweep reads it. */
    private record BlobRow(String sha, long size, String mimeType, long refCount, Instant touched) {}

    /** What one run did (or would do). */
    private static final class Tally {
        long versions;
        long rowsExamined;
        long objectsExamined;
        long rowsDeleted;
        long objectsDeleted;
        long keptYoung;
        long skipped;
        long refCountsUpdated;
    }

    @Override
    public JobResult run(JobContext ctx) {
        int batchSize = ctx.settings().intValue("batchSize");
        int graceHours = ctx.settings().intValue("graceHours");
        Instant cutoff = ctx.now().minus(Duration.ofHours(graceHours));
        Tally tally = new Tally();

        ctx.progress("Marking referenced blobs");
        Map<String, Integer> refs = mark(ctx, batchSize, tally);
        hooks.afterMark();

        ctx.progress("Sweeping blob rows");
        Set<String> rowCandidates = sweepRows(ctx, batchSize, cutoff, refs, tally);

        ctx.progress("Sweeping store objects without a row");
        sweepObjects(ctx, batchSize, cutoff, rowCandidates, tally);

        ObjectNode report = ctx.report();
        report.put("graceHours", graceHours);
        report.put("versionsScanned", tally.versions);
        report.put("marked", refs.size());
        report.put("rowsExamined", tally.rowsExamined);
        report.put("objectsExamined", tally.objectsExamined);
        report.put("rowsDeleted", tally.rowsDeleted);
        report.put("orphanObjectsDeleted", tally.objectsDeleted);
        report.put("keptWithinGrace", tally.keptYoung);
        report.put("skippedChanged", tally.skipped);
        report.put("refCountsUpdated", tally.refCountsUpdated);
        String verb = ctx.dryRun() ? "Would delete " : "Deleted ";
        return JobResult.succeeded(verb + tally.rowsDeleted + " unreferenced blobs and " + tally.objectsDeleted
                + " orphan objects (" + ctx.bytesFreedCount() + " bytes); " + refs.size() + " blobs referenced.");
    }

    /** The referenced hashes, each with its number of references. */
    private Map<String, Integer> mark(JobContext ctx, int batchSize, Tally tally) {
        Map<String, Integer> refs = new HashMap<>();
        long afterId = 0;
        while (true) {
            ctx.checkCancelled();
            long after = afterId;
            List<AssetVersion> page = ctx.inTransaction(
                    () -> mediaVersions.findEveryMediaVersionAfter(after, PageRequest.of(0, batchSize)));
            if (page.isEmpty()) {
                break;
            }
            for (AssetVersion version : page) {
                MediaFiles.blobShas(version.getPayload()).forEach(sha -> refs.merge(sha, 1, Integer::sum));
            }
            tally.versions += page.size();
            afterId = page.get(page.size() - 1).getId();
        }
        jdbc.query("SELECT blob_sha, source_sha FROM media_variant", rs -> {
            refs.merge(rs.getString(1).trim(), 1, Integer::sum);
            refs.putIfAbsent(rs.getString(2).trim(), 0); // a source is marked, but not counted as a reference
        });
        jdbc.query("SELECT log_blob_sha FROM generation_run WHERE log_blob_sha IS NOT NULL",
                (RowCallbackHandler) rs -> refs.merge(rs.getString(1).trim(), 1, Integer::sum));
        return refs;
    }

    /** Sweeps the {@code blob} rows; returns the hashes deleted (or, in a dry run, that would be). */
    private Set<String> sweepRows(JobContext ctx, int batchSize, Instant cutoff, Map<String, Integer> refs, Tally tally) {
        Set<String> candidates = new HashSet<>();
        String after = "";
        while (true) {
            ctx.checkCancelled();
            List<BlobRow> page = page(after, batchSize);
            if (page.isEmpty()) {
                break;
            }
            after = page.get(page.size() - 1).sha();
            tally.rowsExamined += page.size();
            ctx.examined(page.size());
            List<Object[]> refUpdates = new ArrayList<>();
            List<BlobRow> doomed = new ArrayList<>();
            for (BlobRow row : page) {
                Integer count = refs.get(row.sha());
                if (count == null && row.touched().isBefore(cutoff)) {
                    doomed.add(row);
                    continue;
                }
                if (count == null) {
                    tally.keptYoung++;
                }
                int expected = count == null ? 0 : count;
                if (row.refCount() != expected) {
                    refUpdates.add(new Object[] {expected, row.sha()});
                }
            }
            tally.refCountsUpdated += refUpdates.size();
            if (!ctx.dryRun() && !refUpdates.isEmpty()) {
                ctx.inTransaction(() -> {
                    jdbc.batchUpdate("UPDATE blob SET ref_count = ? WHERE sha256 = ?", refUpdates);
                });
            }
            for (BlobRow row : doomed) {
                ctx.checkCancelled();
                boolean deleted = ctx.dryRun() || deleteRow(ctx, row.sha(), cutoff);
                if (deleted) {
                    candidates.add(row.sha());
                    tally.rowsDeleted++;
                    ctx.affected(1);
                    ctx.bytesFreed(row.size());
                    ctx.sample(sample(row.sha(), "row", row.mimeType(), row.size()));
                } else {
                    tally.skipped++;
                }
            }
        }
        return candidates;
    }

    /** Deletes an unreferenced blob under its row lock, after re-checking; {@code false} when it must stay. */
    private boolean deleteRow(JobContext ctx, String sha, Instant cutoff) {
        return ctx.inTransaction(() -> {
            Blob blob = blobs.findForUpdate(sha).orElse(null);
            if (blob == null) {
                return false;
            }
            Instant touched = blob.getLastReferencedAt() != null ? blob.getLastReferencedAt() : blob.getCreatedAt();
            if (!touched.isBefore(cutoff) || referencedOutsideVersions(sha)) {
                return false;
            }
            hooks.beforeDelete(sha);
            store.delete(sha);
            blobs.delete(blob);
            blobs.flush();
            return true;
        });
    }

    /** Whether a {@code media_variant} row or a generation run references {@code sha} now. */
    private boolean referencedOutsideVersions(String sha) {
        Integer n = jdbc.queryForObject(
                "SELECT (SELECT COUNT(*) FROM media_variant WHERE blob_sha = ? OR source_sha = ?)"
                        + " + (SELECT COUNT(*) FROM generation_run WHERE log_blob_sha = ?)",
                Integer.class, sha, sha, sha);
        return n != null && n > 0;
    }

    /** Sweeps store objects without a row. */
    private void sweepObjects(JobContext ctx, int batchSize, Instant cutoff, Set<String> rowCandidates, Tally tally) {
        List<BlobStore.StoredObject> buffer = new ArrayList<>();
        store.forEachObject(object -> {
            buffer.add(object);
            if (buffer.size() >= batchSize) {
                sweepObjectBatch(ctx, buffer, cutoff, rowCandidates, tally);
                buffer.clear();
            }
        });
        sweepObjectBatch(ctx, buffer, cutoff, rowCandidates, tally);
    }

    private void sweepObjectBatch(
            JobContext ctx, List<BlobStore.StoredObject> objects, Instant cutoff, Set<String> rowCandidates, Tally tally) {
        if (objects.isEmpty()) {
            return;
        }
        ctx.checkCancelled();
        tally.objectsExamined += objects.size();
        ctx.examined(objects.size());
        Set<String> withRow = existingRows(objects.stream().map(BlobStore.StoredObject::sha256).toList());
        for (BlobStore.StoredObject object : objects) {
            String sha = object.sha256();
            if (withRow.contains(sha) || rowCandidates.contains(sha)) {
                continue;
            }
            if (!object.lastModified().isBefore(cutoff)) {
                tally.keptYoung++;
                continue;
            }
            boolean deleted;
            try {
                deleted = ctx.dryRun() || claimAndDelete(ctx, object);
            } catch (RuntimeException e) {
                deleted = false; // a write of the same bytes holds or took the key: they are referenced now
            }
            if (deleted) {
                tally.objectsDeleted++;
                ctx.affected(1);
                ctx.bytesFreed(object.sizeBytes());
                ctx.sample(sample(sha, "object", null, object.sizeBytes()));
            } else {
                tally.skipped++;
            }
        }
    }

    /**
     * Claims rowless bytes by inserting a placeholder row with their key (a concurrent {@code BlobWriter} insert of the
     * same key waits or wins), deletes them and the placeholder in one transaction.
     */
    private boolean claimAndDelete(JobContext ctx, BlobStore.StoredObject object) {
        return ctx.inTransaction(() -> {
            String sha = object.sha256();
            Blob placeholder = blobs.saveAndFlush(
                    new Blob(sha, object.sizeBytes(), null, store.storageKey(sha), 0, ctx.now()));
            hooks.beforeDelete(sha);
            store.delete(sha);
            blobs.delete(placeholder);
            blobs.flush();
            return true;
        });
    }

    private Set<String> existingRows(List<String> shas) {
        Set<String> out = new HashSet<>();
        String in = String.join(",", Collections.nCopies(shas.size(), "?"));
        jdbc.query("SELECT sha256 FROM blob WHERE sha256 IN (" + in + ")", rs -> {
            out.add(rs.getString(1).trim());
        }, shas.toArray());
        return out;
    }

    private List<BlobRow> page(String after, int batchSize) {
        return jdbc.query(
                "SELECT sha256, size_bytes, mime_type, ref_count, created_at, last_referenced_at FROM blob"
                        + " WHERE sha256 > ? ORDER BY sha256 LIMIT ?",
                (rs, i) -> {
                    OffsetDateTime created = rs.getObject("created_at", OffsetDateTime.class);
                    OffsetDateTime referenced = rs.getObject("last_referenced_at", OffsetDateTime.class);
                    return new BlobRow(
                            rs.getString("sha256").trim(),
                            rs.getLong("size_bytes"),
                            rs.getString("mime_type"),
                            rs.getLong("ref_count"),
                            (referenced != null ? referenced : created).toInstant());
                },
                after,
                batchSize);
    }

    private static ObjectNode sample(String sha, String kind, String mimeType, long size) {
        ObjectNode item = JsonNodeFactory.instance.objectNode().put("sha256", sha).put("kind", kind);
        if (mimeType != null) {
            item.put("mimeType", mimeType);
        }
        return item.put("sizeBytes", size);
    }
}
