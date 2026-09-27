package com.acme.staticforge;

import static org.assertj.core.api.Assertions.assertThat;

import com.acme.staticforge.asset.AssetReference;
import com.acme.staticforge.asset.AssetReferenceRepository;
import com.acme.staticforge.asset.AssetRepository;
import com.acme.staticforge.asset.AssetVersion;
import com.acme.staticforge.asset.AssetVersionRepository;
import com.acme.staticforge.asset.reference.ReferenceEdge;
import com.fasterxml.jackson.databind.JsonNode;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

/**
 * Revision compaction test support (M29.4.2): back-dated history (a revision's {@code created_at} is set directly —
 * {@code RevisionServiceImpl} stamps {@code Instant.now()}), and exact reads of a project's versions and references
 * at every revision, to compare history before and after a compaction.
 */
@Component
public class CompactionFixtures {

    /** A day far enough in the past for any {@code olderThanDays}. */
    public static final Instant DAY_1 = Instant.parse("2025-01-10T06:00:00Z");

    private final JdbcTemplate jdbc;
    private final AssetRepository assets;
    private final AssetVersionRepository versions;
    private final AssetReferenceRepository references;

    public CompactionFixtures(
            JdbcTemplate jdbc, AssetRepository assets, AssetVersionRepository versions, AssetReferenceRepository references) {
        this.jdbc = jdbc;
        this.assets = assets;
        this.versions = versions;
        this.references = references;
    }

    /** The project's newest revision. */
    public long head(long projectId) {
        Long head = jdbc.queryForObject("SELECT MAX(revision_id) FROM revision WHERE project_id = ?", Long.class, projectId);
        return head == null ? 0 : head;
    }

    /** Dates revisions {@code from..to} (inclusive) on {@code day}: one minute apart, starting at {@code day}. */
    public void backdate(long projectId, long from, long to, Instant day) {
        for (long r = from; r <= to; r++) {
            jdbc.update("UPDATE revision SET created_at = ? WHERE project_id = ? AND revision_id = ?",
                    OffsetDateTime.ofInstant(day.plusSeconds(60 * (r - from)), ZoneOffset.UTC), projectId, r);
        }
    }

    public long assetId(long projectId, UUID uuid) {
        return assets.findByProjectIdAndUuid(projectId, uuid).orElseThrow().getId();
    }

    /** The asset's versions, oldest first. */
    public List<AssetVersion> versions(long assetId) {
        List<AssetVersion> out = new ArrayList<>(versions.findByAssetIdOrderByValidFromRevisionDesc(assetId));
        out.sort(Comparator.comparingLong(AssetVersion::getValidFromRevision));
        return out;
    }

    /** The version valid at each revision {@code 1..head} (absent while the asset didn't exist); fails on overlaps. */
    public Map<Long, AssetVersion> versionAt(long assetId, long head) {
        List<AssetVersion> all = versions(assetId);
        Map<Long, AssetVersion> out = new TreeMap<>();
        for (long r = 1; r <= head; r++) {
            long rr = r;
            List<AssetVersion> valid = all.stream()
                    .filter(v -> v.getValidFromRevision() <= rr && (v.getValidToRevision() == null || v.getValidToRevision() > rr))
                    .toList();
            assertThat(valid).as("versions of asset %s valid at r%s", assetId, r).hasSizeLessThanOrEqualTo(1);
            if (!valid.isEmpty()) {
                out.put(r, valid.get(0));
            }
        }
        return out;
    }

    /**
     * Exactly one version valid at every revision from the asset's first to {@code head}, and intervals contiguous
     * (each version ends where the next starts; only the last is open).
     */
    public void assertGapless(long assetId, long head) {
        List<AssetVersion> all = versions(assetId);
        assertThat(all).isNotEmpty();
        for (int i = 0; i < all.size() - 1; i++) {
            assertThat(all.get(i).getValidToRevision())
                    .as("version %s ends where the next starts", all.get(i).getId())
                    .isEqualTo(all.get(i + 1).getValidFromRevision());
        }
        assertThat(all.get(all.size() - 1).getValidToRevision()).as("only the last version is open").isNull();
        Map<Long, AssetVersion> at = versionAt(assetId, head);
        for (long r = all.get(0).getValidFromRevision(); r <= head; r++) {
            assertThat(at).as("a version of asset %s valid at r%s", assetId, r).containsKey(r);
        }
    }

    /** What a read at each revision returns: {@code deleted}, display name and payload of the version valid there. */
    public Map<Long, JsonNode> readsAt(long assetId, long head) {
        Map<Long, JsonNode> out = new TreeMap<>();
        versionAt(assetId, head).forEach((r, v) -> out.put(r, state(v)));
        return out;
    }

    /** The outgoing edges of the asset valid at each revision {@code 1..head}; fails on a duplicate edge. */
    public Map<Long, Set<ReferenceEdge>> edgesAt(long assetId, long head) {
        List<AssetReference> rows = references.findByFromAssetId(assetId);
        Map<Long, Set<ReferenceEdge>> out = new LinkedHashMap<>();
        for (long r = 1; r <= head; r++) {
            long rr = r;
            Set<ReferenceEdge> edges = new HashSet<>();
            rows.stream()
                    .filter(e -> e.getValidFromRevision() <= rr && (e.getValidToRevision() == null || e.getValidToRevision() > rr))
                    .forEach(e -> assertThat(edges.add(ReferenceEdge.of(e))).as("duplicate edge at r%s", rr).isTrue());
            out.put(r, edges);
        }
        return out;
    }

    public boolean compacted(long projectId, long revision) {
        return Boolean.TRUE.equals(jdbc.queryForObject(
                "SELECT compacted FROM revision WHERE project_id = ? AND revision_id = ?", Boolean.class, projectId, revision));
    }

    public Long compactedThrough(long projectId) {
        return jdbc.queryForObject("SELECT compacted_through FROM project WHERE id = ?", Long.class, projectId);
    }

    private static JsonNode state(AssetVersion v) {
        return com.fasterxml.jackson.databind.node.JsonNodeFactory.instance.objectNode()
                .put("deleted", v.isDeleted())
                .put("displayName", v.getDisplayName())
                .set("payload", v.getPayload() == null ? null : v.getPayload().deepCopy());
    }
}
