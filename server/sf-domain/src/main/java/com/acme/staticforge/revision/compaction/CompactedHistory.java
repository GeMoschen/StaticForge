package com.acme.staticforge.revision.compaction;

import java.util.Collection;
import java.util.Collections;
import java.util.List;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

/**
 * Whether a point-in-time read shows compacted history (M29.4.3, epic decision 13 "Reads"). A read of an asset at
 * {@code R} is <em>compacted</em> when the version valid at {@code R} was moved back over {@code R} by revision
 * compaction ({@code original_valid_from > R}): the state shown is the end of its group, later than the exact state at
 * {@code R}.
 *
 * <p>Cheap on hot paths: every check first reads {@code project.compacted_through} and answers {@code false} without
 * touching versions when the project was never compacted or {@code R} is newer than anything compaction processed (a
 * read at the current revision never is).
 */
@Service
public class CompactedHistory {

    private final JdbcTemplate jdbc;

    public CompactedHistory(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    /** Whether a read of the asset {@code uuid} at {@code revision} is compacted; {@code false} for {@code null}. */
    public boolean assetCompactedAt(long projectId, UUID uuid, Long revision) {
        if (revision == null || !mayBeCompacted(projectId, revision)) {
            return false;
        }
        return exists("""
                SELECT COUNT(*) FROM asset_version v JOIN asset a ON a.id = v.asset_id
                WHERE a.project_id = ? AND a.uuid = ?
                  AND v.valid_from_revision <= ? AND (v.valid_to_revision IS NULL OR v.valid_to_revision > ?)
                  AND v.original_valid_from > ?
                """, projectId, uuid, revision, revision, revision);
    }

    /** Whether a read of any of {@code uuids} at {@code revision} is compacted. */
    public boolean anyCompactedAt(long projectId, Collection<UUID> uuids, Long revision) {
        if (revision == null || uuids.isEmpty() || !mayBeCompacted(projectId, revision)) {
            return false;
        }
        List<UUID> list = List.copyOf(uuids);
        Object[] args = new Object[list.size() + 4];
        args[0] = projectId;
        for (int i = 0; i < list.size(); i++) {
            args[i + 1] = list.get(i);
        }
        args[list.size() + 1] = revision;
        args[list.size() + 2] = revision;
        args[list.size() + 3] = revision;
        return exists("SELECT COUNT(*) FROM asset_version v JOIN asset a ON a.id = v.asset_id "
                + "WHERE a.project_id = ? AND a.uuid IN (" + String.join(", ", Collections.nCopies(list.size(), "?")) + ") "
                + "AND v.valid_from_revision <= ? AND (v.valid_to_revision IS NULL OR v.valid_to_revision > ?) "
                + "AND v.original_valid_from > ?", args);
    }

    /** Whether the project's snapshot at {@code revision} holds any compacted asset (a project-wide restore). */
    public boolean snapshotCompactedAt(long projectId, long revision) {
        if (!mayBeCompacted(projectId, revision)) {
            return false;
        }
        return exists("""
                SELECT COUNT(*) FROM asset_version v JOIN asset a ON a.id = v.asset_id
                WHERE a.project_id = ?
                  AND v.valid_from_revision <= ? AND (v.valid_to_revision IS NULL OR v.valid_to_revision > ?)
                  AND v.original_valid_from > ?
                """, projectId, revision, revision, revision);
    }

    /**
     * Whether any read at {@code revision} can be compacted: the project was compacted and {@code revision} is not newer
     * than {@code compacted_through}. Every absorbed interval ends at a survivor's original revision, which compaction
     * processed, so a later revision never shows compacted history.
     */
    public boolean mayBeCompacted(long projectId, long revision) {
        Long through = compactedThrough(projectId);
        return through != null && revision <= through;
    }

    /** {@code project.compacted_through}: the newest revision compaction processed; {@code null} when it never ran. */
    public Long compactedThrough(long projectId) {
        List<Long> through = jdbc.queryForList("SELECT compacted_through FROM project WHERE id = ?", Long.class, projectId);
        return through.isEmpty() ? null : through.get(0);
    }

    private boolean exists(String sql, Object... args) {
        Long n = jdbc.queryForObject(sql, Long.class, args);
        return n != null && n > 0;
    }
}
