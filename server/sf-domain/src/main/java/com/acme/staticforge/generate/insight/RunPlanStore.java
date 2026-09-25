package com.acme.staticforge.generate.insight;

import com.acme.staticforge.generate.GenerationRun;
import com.acme.staticforge.generate.GenerationRunRepository;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Types;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.Pageable;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * The stored plans of generation runs (M22.1.2): entries and reason chains, normalized.
 *
 * <p>A reason chain is stored as nodes, one per asset on some chain of the run, each pointing at its parent towards
 * the root; the root node carries the root kind and revision. The expansion's parent pointers form a tree, so every
 * chain through an asset shares that asset's node. An entry row points at the node of its planned asset (change-driven
 * reasons) or carries its root kind alone (FULL, fallback, explicit scope, base build gap). Rows are written with JDBC
 * batches, in entry order, so reading them by id returns the plan's order on every database.
 *
 * <p>Names are read tolerantly: a plan written by a newer build (an edge kind this build doesn't know) reads as
 * {@code UNKNOWN} instead of failing.
 */
@Service
public class RunPlanStore {

    /** Whether a run's stored plan still has its entries; {@code false} once retention pruned them. */
    public static final String PLAN_AVAILABLE = "planAvailable";

    private static final int BATCH = 500;
    private static final int ID_CHUNK = 1000;

    private final JdbcTemplate jdbc;
    private final GenerationRunRepository runs;

    public RunPlanStore(JdbcTemplate jdbc, GenerationRunRepository runs) {
        this.jdbc = jdbc;
        this.runs = runs;
    }

    // ------------------------------------------------------------------
    // Write
    // ------------------------------------------------------------------

    private record NodeRow(
            UUID assetUuid,
            String assetType,
            String uid,
            UUID parentUuid,
            String edgeKind,
            String referenceKind,
            String sourcePath,
            String rootKind,
            Long rootRevision) {}

    /** Stores the entries of run {@code runId}'s plan, in order, with their chains as shared nodes. */
    @Transactional
    public void save(long runId, List<PlanEntryRecord> entries) {
        Map<UUID, NodeRow> nodes = new LinkedHashMap<>();
        for (PlanEntryRecord entry : entries) {
            RebuildReason reason = entry.reason();
            if (!reason.rootKind().changeDriven()) {
                continue;
            }
            List<RebuildStep> steps = reason.steps();
            for (int i = 0; i < steps.size(); i++) {
                RebuildStep step = steps.get(i);
                UUID parent = i + 1 < steps.size() ? steps.get(i + 1).assetUuid() : reason.rootUuid();
                nodes.putIfAbsent(step.assetUuid(), new NodeRow(
                        step.assetUuid(), step.assetType(), step.uid(), parent, name(step.edge()), step.referenceKind(),
                        step.sourcePath(), null, null));
            }
            nodes.putIfAbsent(reason.rootUuid(), new NodeRow(
                    reason.rootUuid(), reason.rootType(), reason.rootUid(), null, null, null, null,
                    reason.rootKind().name(), reason.rootRevision()));
        }

        jdbc.batchUpdate(
                """
                INSERT INTO generation_run_plan_node
                    (run_id, asset_uuid, asset_type, uid, parent_asset_uuid, edge_kind, reference_kind, source_path,
                     root_kind, root_revision)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                List.copyOf(nodes.values()),
                BATCH,
                (ps, node) -> {
                    ps.setLong(1, runId);
                    ps.setObject(2, node.assetUuid());
                    ps.setString(3, node.assetType());
                    ps.setString(4, truncate(node.uid(), 200));
                    ps.setObject(5, node.parentUuid());
                    ps.setString(6, node.edgeKind());
                    ps.setString(7, node.referenceKind());
                    ps.setString(8, truncate(node.sourcePath(), 500));
                    ps.setString(9, node.rootKind());
                    if (node.rootRevision() == null) {
                        ps.setNull(10, Types.BIGINT);
                    } else {
                        ps.setLong(10, node.rootRevision());
                    }
                });

        jdbc.batchUpdate(
                """
                INSERT INTO generation_run_plan_entry
                    (run_id, asset_uuid, asset_type, uid, display_name, channel, output_path, page_number, root_kind,
                     node_asset_uuid, cause_count, locale)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                entries,
                BATCH,
                (ps, entry) -> {
                    RebuildReason reason = entry.reason();
                    ps.setLong(1, runId);
                    ps.setObject(2, entry.assetUuid());
                    ps.setString(3, entry.assetType());
                    ps.setString(4, truncate(entry.uid(), 200));
                    ps.setString(5, truncate(entry.displayName(), 500));
                    ps.setString(6, entry.channel());
                    ps.setString(7, entry.outputPath());
                    if (entry.pageNumber() == null) {
                        ps.setNull(8, Types.INTEGER);
                    } else {
                        ps.setInt(8, entry.pageNumber());
                    }
                    ps.setString(9, reason.rootKind().name());
                    ps.setObject(10, reason.rootKind().changeDriven()
                            ? (reason.steps().isEmpty() ? reason.rootUuid() : reason.steps().get(0).assetUuid())
                            : null);
                    ps.setInt(11, reason.causeCount());
                    ps.setString(12, entry.locale());
                });
    }

    // ------------------------------------------------------------------
    // Read
    // ------------------------------------------------------------------

    /** The plan summary of run {@code runId}; empty when the run never got past PLAN. */
    public Optional<JsonNode> summary(long runId) {
        return runs.findById(runId).map(GenerationRun::getPlanSummary);
    }

    /** Whether run {@code runId}'s plan entries are still stored. */
    public static boolean available(JsonNode summary) {
        return summary != null && summary.path(PLAN_AVAILABLE).asBoolean(true);
    }

    private record EntryRow(PlanEntryRecord entry, String rootKind, UUID nodeUuid, int causeCount) {}

    /** A page of run {@code runId}'s entries passing {@code filter}, in plan order, with their reasons. */
    @Transactional(readOnly = true)
    public Page<PlanEntryRecord> entries(long runId, PlanEntryRecord.Filter filter, Pageable pageable) {
        StringBuilder where = new StringBuilder(" WHERE run_id = ?");
        List<Object> args = new ArrayList<>();
        args.add(runId);
        if (filter.rootKind() != null) {
            where.append(" AND root_kind = ?");
            args.add(filter.rootKind().name());
        }
        if (filter.channel() != null) {
            where.append(" AND channel = ?");
            args.add(filter.channel());
        }
        if (filter.assetUuid() != null) {
            where.append(" AND asset_uuid = ?");
            args.add(filter.assetUuid());
        }
        String query = filter.normalizedQuery();
        if (query != null) {
            String like = "%" + query.replace("!", "!!").replace("%", "!%").replace("_", "!_") + "%";
            where.append(" AND (LOWER(uid) LIKE ? ESCAPE '!' OR LOWER(display_name) LIKE ? ESCAPE '!'"
                    + " OR LOWER(output_path) LIKE ? ESCAPE '!')");
            args.add(like);
            args.add(like);
            args.add(like);
        }
        Long total = jdbc.queryForObject("SELECT COUNT(*) FROM generation_run_plan_entry" + where, Long.class, args.toArray());

        List<Object> pageArgs = new ArrayList<>(args);
        String paging = "";
        if (pageable.isPaged()) {
            paging = " LIMIT ? OFFSET ?";
            pageArgs.add(pageable.getPageSize());
            pageArgs.add(pageable.getOffset());
        }
        List<EntryRow> rows = jdbc.query(
                "SELECT asset_uuid, asset_type, uid, display_name, channel, output_path, page_number, root_kind,"
                        + " node_asset_uuid, cause_count, locale FROM generation_run_plan_entry" + where + " ORDER BY id" + paging,
                (rs, i) -> entryRow(rs),
                pageArgs.toArray());

        FallbackCause fallback = summary(runId)
                .map(summary -> FallbackCause.parse(summary.path("fallbackCause").asText(null)))
                .orElse(null);
        Map<UUID, NodeRow> nodes = loadChains(runId, rows.stream().map(EntryRow::nodeUuid).toList());
        List<PlanEntryRecord> content = rows.stream().map(row -> withReason(row, nodes, fallback)).toList();
        return new PageImpl<>(content, pageable, total == null ? 0 : total);
    }

    /** The reason run {@code runId} planned {@code assetUuid} (in {@code channel}, when given). */
    @Transactional(readOnly = true)
    public Optional<RebuildReason> reasonFor(long runId, UUID assetUuid, String channel) {
        return entries(runId, new PlanEntryRecord.Filter(null, channel, assetUuid, null), Pageable.ofSize(1))
                .stream()
                .findFirst()
                .map(PlanEntryRecord::reason);
    }

    private static EntryRow entryRow(ResultSet rs) throws SQLException {
        Integer pageNumber = rs.getObject("page_number") == null ? null : rs.getInt("page_number");
        PlanEntryRecord entry = new PlanEntryRecord(
                rs.getObject("asset_uuid", UUID.class),
                rs.getString("asset_type"),
                rs.getString("uid"),
                rs.getString("display_name"),
                rs.getString("channel"),
                rs.getString("output_path"),
                pageNumber,
                null,
                rs.getString("locale"));
        return new EntryRow(entry, rs.getString("root_kind"), rs.getObject("node_asset_uuid", UUID.class), rs.getInt("cause_count"));
    }

    /** The nodes of every chain starting at {@code starts}, loaded level by level towards the roots. */
    private Map<UUID, NodeRow> loadChains(long runId, List<UUID> starts) {
        Map<UUID, NodeRow> nodes = new HashMap<>();
        Set<UUID> pending = new LinkedHashSet<>();
        starts.stream().filter(uuid -> uuid != null).forEach(pending::add);
        while (!pending.isEmpty()) {
            List<UUID> level = List.copyOf(pending);
            pending.clear();
            for (int from = 0; from < level.size(); from += ID_CHUNK) {
                List<UUID> chunk = level.subList(from, Math.min(from + ID_CHUNK, level.size()));
                String placeholders = String.join(",", java.util.Collections.nCopies(chunk.size(), "?"));
                List<Object> args = new ArrayList<>();
                args.add(runId);
                args.addAll(chunk);
                jdbc.query(
                        "SELECT asset_uuid, asset_type, uid, parent_asset_uuid, edge_kind, reference_kind, source_path,"
                                + " root_kind, root_revision FROM generation_run_plan_node WHERE run_id = ? AND asset_uuid IN ("
                                + placeholders + ")",
                        (ResultSet rs) -> {
                            NodeRow node = new NodeRow(
                                    rs.getObject("asset_uuid", UUID.class),
                                    rs.getString("asset_type"),
                                    rs.getString("uid"),
                                    rs.getObject("parent_asset_uuid", UUID.class),
                                    rs.getString("edge_kind"),
                                    rs.getString("reference_kind"),
                                    rs.getString("source_path"),
                                    rs.getString("root_kind"),
                                    rs.getObject("root_revision") == null ? null : rs.getLong("root_revision"));
                            nodes.put(node.assetUuid(), node);
                        },
                        args.toArray());
            }
            for (UUID uuid : level) {
                NodeRow node = nodes.get(uuid);
                if (node != null && node.parentUuid() != null && !nodes.containsKey(node.parentUuid())) {
                    pending.add(node.parentUuid());
                }
            }
        }
        return nodes;
    }

    private static PlanEntryRecord withReason(EntryRow row, Map<UUID, NodeRow> nodes, FallbackCause fallback) {
        PlanEntryRecord entry = row.entry();
        RebuildRootKind kind = RebuildRootKind.parse(row.rootKind());
        RebuildReason reason;
        if (kind.changeDriven() && row.nodeUuid() != null) {
            List<RebuildStep> steps = new ArrayList<>();
            NodeRow node = nodes.get(row.nodeUuid());
            Set<UUID> seen = new LinkedHashSet<>();
            while (node != null && node.parentUuid() != null && seen.add(node.assetUuid())) {
                steps.add(new RebuildStep(
                        node.assetUuid(), node.assetType(), node.uid(), RebuildEdgeKind.parse(node.edgeKind()),
                        node.referenceKind(), node.sourcePath()));
                node = nodes.get(node.parentUuid());
            }
            reason = node == null
                    ? new RebuildReason(kind, null, null, null, null, row.causeCount(), null, steps)
                    : new RebuildReason(
                            RebuildRootKind.parse(node.rootKind()), node.assetUuid(), node.assetType(), node.uid(),
                            node.rootRevision(), row.causeCount(), null, steps);
        } else if (kind == RebuildRootKind.EXPLICIT_SCOPE || kind == RebuildRootKind.NOT_IN_BASE_BUILD) {
            reason = RebuildReason.of(kind, null, entry.assetUuid(), entry.assetType(), entry.uid());
        } else {
            reason = RebuildReason.of(kind, kind == RebuildRootKind.INCREMENTAL_FALLBACK_FULL ? fallback : null, null, null, null);
        }
        return new PlanEntryRecord(
                entry.assetUuid(), entry.assetType(), entry.uid(), entry.displayName(), entry.channel(),
                entry.outputPath(), entry.pageNumber(), reason, entry.locale());
    }

    // ------------------------------------------------------------------
    // Retention
    // ------------------------------------------------------------------

    /**
     * Keeps the stored plans of the newest {@code keep} runs of a project that have one, and deletes the entries and
     * nodes of older ones. Their summaries stay, marked {@code planAvailable: false}; the run rows are untouched.
     *
     * @return the number of runs whose plan was pruned
     */
    @Transactional
    public int prune(long projectId, int keep) {
        int kept = 0;
        int pruned = 0;
        for (GenerationRun run : runs.findByProjectIdOrderByIdDesc(projectId)) {
            JsonNode summary = run.getPlanSummary();
            if (summary == null) {
                continue;
            }
            if (kept < Math.max(keep, 0)) {
                kept++;
                continue;
            }
            if (!available(summary)) {
                continue;
            }
            jdbc.update("DELETE FROM generation_run_plan_entry WHERE run_id = ?", run.getId());
            jdbc.update("DELETE FROM generation_run_plan_node WHERE run_id = ?", run.getId());
            ObjectNode marked = summary.deepCopy();
            marked.put(PLAN_AVAILABLE, false);
            run.setPlanSummary(marked);
            runs.save(run);
            pruned++;
        }
        return pruned;
    }

    private static String name(Enum<?> value) {
        return value == null ? null : value.name();
    }

    private static String truncate(String value, int max) {
        return value == null || value.length() <= max ? value : value.substring(0, max);
    }
}
