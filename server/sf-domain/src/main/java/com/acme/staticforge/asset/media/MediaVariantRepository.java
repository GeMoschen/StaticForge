package com.acme.staticforge.asset.media;

import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.Collection;
import java.util.Collections;
import java.util.HashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

/**
 * The {@code media_variant} table (M29.3.2, epic decision 10): variants recorded per source blob and definition,
 * outside any version payload. Rows are derived data; see {@link MediaVariantResolver}.
 */
@Repository
public class MediaVariantRepository {

    /** How many source hashes one {@code IN} list carries. */
    private static final int CHUNK = 500;

    /** One recorded variant: {@code blobSha} holds the bytes of {@code spec} encoded from {@code sourceSha}. */
    public record Row(String sourceSha, MediaVariantSpec spec, String blobSha) {}

    private final JdbcTemplate jdbc;

    public MediaVariantRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    /** The rows of every hash in {@code sourceShas}, grouped by source hash; hashes without rows are absent. */
    public Map<String, List<Row>> findBySourceShas(Collection<String> sourceShas) {
        if (sourceShas == null || sourceShas.isEmpty()) {
            return Map.of();
        }
        Map<String, List<Row>> out = new HashMap<>();
        List<String> all = new ArrayList<>(new LinkedHashSet<>(sourceShas));
        for (int from = 0; from < all.size(); from += CHUNK) {
            List<String> chunk = all.subList(from, Math.min(all.size(), from + CHUNK));
            String in = String.join(",", Collections.nCopies(chunk.size(), "?"));
            jdbc.query(
                    "SELECT source_sha, name, width, format, quality, blob_sha FROM media_variant WHERE source_sha IN ("
                            + in + ") ORDER BY id",
                    rs -> {
                        Row row = new Row(
                                rs.getString("source_sha").trim(),
                                new MediaVariantSpec(rs.getString("name"), rs.getInt("width"), rs.getString("format"),
                                        rs.getInt("quality")),
                                rs.getString("blob_sha").trim());
                        out.computeIfAbsent(row.sourceSha(), k -> new ArrayList<>()).add(row);
                    },
                    chunk.toArray());
        }
        return out;
    }

    /** Whether {@code sourceSha} has a row for {@code spec}. */
    public boolean exists(String sourceSha, MediaVariantSpec spec) {
        Integer n = jdbc.queryForObject(
                "SELECT COUNT(*) FROM media_variant WHERE source_sha = ? AND name = ? AND width = ? AND format = ?"
                        + " AND quality = ?",
                Integer.class, sourceSha, spec.name(), spec.width(), spec.format(), spec.quality());
        return n != null && n > 0;
    }

    /**
     * Records that {@code blobSha} is {@code spec} of {@code sourceSha}; a no-op when a row for that definition exists
     * (idempotent, in the caller's transaction). Two transactions recording the same new variant at the same moment
     * can still collide on the unique key; the loser fails and its caller retries (the backfill on its next run).
     */
    public void insertIfAbsent(String sourceSha, MediaVariantSpec spec, String blobSha, Instant createdAt) {
        jdbc.update(
                "INSERT INTO media_variant (source_sha, name, width, format, quality, blob_sha, created_at)"
                        + " SELECT ?, ?, ?, ?, ?, ?, ? FROM (VALUES (1)) AS one (x) WHERE NOT EXISTS (SELECT 1 FROM media_variant"
                        + " WHERE source_sha = ? AND name = ? AND width = ? AND format = ? AND quality = ?)",
                sourceSha, spec.name(), spec.width(), spec.format(), spec.quality(), blobSha, OffsetDateTime.ofInstant(createdAt, ZoneOffset.UTC),
                sourceSha, spec.name(), spec.width(), spec.format(), spec.quality());
    }
}
