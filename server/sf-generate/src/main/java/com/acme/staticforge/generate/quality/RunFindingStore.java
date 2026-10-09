package com.acme.staticforge.generate.quality;

import com.acme.staticforge.generate.GenerationRun;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Types;
import java.util.ArrayList;
import java.util.Collection;
import java.util.Collections;
import java.util.Comparator;
import java.util.EnumMap;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;
import java.util.UUID;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.Pageable;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowCallbackHandler;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * The stored quality check findings of generation runs (M30.1.2, epic decision 9): table {@code generation_run_finding},
 * written with multi-row inserts and capped — at most {@code sf.quality.max-findings-per-output} findings of one rule per
 * output and {@code sf.quality.max-findings-per-run} per run. What the caps drop is counted, not stored; errors are
 * stored before warnings, so a cap never drops an error while it keeps a warning. The counts a run carries
 * ({@link Counts}) cover every finding, stored or not.
 */
@Service
public class RunFindingStore {

    /** Findings inserted by one statement: 13 parameters each, well within every driver's parameter limit. */
    private static final int ROWS_PER_INSERT = 100;

    private static final int COLUMNS = 13;

    private static final String INSERT_PREFIX = """
            INSERT INTO generation_run_finding
                (run_id, asset_uuid, channel, locale, page_number, output_path, code, category, severity, message,
                 selector, section_instance_id, carried)
            VALUES\s""";

    private static final String ROW = "(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)";

    private static final String INSERT_FULL =
            INSERT_PREFIX + String.join(", ", Collections.nCopies(ROWS_PER_INSERT, ROW));

    private static final int MAX_MESSAGE = 2000;
    private static final int MAX_SELECTOR = 1000;
    private static final int MAX_SECTION = 100;
    private static final int MAX_PATH = 1000;

    private final JdbcTemplate jdbc;
    private final QualityProperties properties;

    public RunFindingStore(JdbcTemplate jdbc, QualityProperties properties) {
        this.jdbc = jdbc;
        this.properties = properties;
    }

    /**
     * What a run found, as the run row carries it.
     *
     * @param errors findings with severity {@code ERROR}
     * @param warnings findings with severity {@code WARNING}
     * @param byCategory findings per category (every category present, possibly 0)
     * @param truncated findings the caps kept from being stored
     */
    public record Counts(int errors, int warnings, Map<QualityCategory, Integer> byCategory, int truncated) {

        public Counts {
            Map<QualityCategory, Integer> all = new EnumMap<>(QualityCategory.class);
            for (QualityCategory category : QualityCategory.values()) {
                all.put(category, byCategory == null ? 0 : byCategory.getOrDefault(category, 0));
            }
            byCategory = Map.copyOf(all);
        }

        /** No findings. */
        public static Counts none() {
            return new Counts(0, 0, Map.of(), 0);
        }

        /** {@code {"links": n, "seo": n, "accessibility": n}} — the run's {@code finding_counts}. */
        public JsonNode categoriesJson() {
            ObjectNode node = JsonNodeFactory.instance.objectNode();
            for (QualityCategory category : QualityCategory.values()) {
                node.put(category.key(), byCategory.get(category));
            }
            return node;
        }

        /** Writes the counts onto {@code run}. */
        public void applyTo(GenerationRun run) {
            run.setFindingErrors(errors);
            run.setFindingWarnings(warnings);
            run.setFindingTruncated(truncated);
            run.setFindingCounts(categoriesJson());
        }

        /** The counts a run carries; {@code null} for a run that never stored any (before M30, or not finished). */
        public static Counts of(GenerationRun run) {
            JsonNode json = run.getFindingCounts();
            if (json == null || json.isNull()) {
                return null;
            }
            Map<QualityCategory, Integer> byCategory = new EnumMap<>(QualityCategory.class);
            for (QualityCategory category : QualityCategory.values()) {
                byCategory.put(category, json.path(category.key()).asInt(0));
            }
            return new Counts(run.getFindingErrors(), run.getFindingWarnings(), byCategory, run.getFindingTruncated());
        }
    }

    /**
     * A run's findings ready to store: what {@link #prepare} decided without touching the database.
     *
     * @param counts the counts over every finding, with what the caps drop
     * @param kept the findings the caps keep, in the order they are stored (errors first, then by output and code)
     */
    public record Prepared(Counts counts, List<Finding> kept) {

        public Prepared {
            kept = List.copyOf(kept);
        }
    }

    /**
     * Stores the findings of run {@code runId} within the caps. Runs in the caller's transaction (the run's REPORT
     * write), so a run that isn't recorded stores no findings.
     *
     * @return the counts over every finding, with what the caps dropped
     */
    @Transactional
    public Counts save(long runId, List<Finding> findings) {
        return save(runId, prepare(findings));
    }

    /**
     * Stores findings {@link #prepare prepared} before — a build prepares them while it writes its files, and stores
     * them in its REPORT write like {@link #save(long, List)}.
     *
     * @return the prepared counts
     */
    @Transactional
    public Counts save(long runId, Prepared prepared) {
        List<Finding> kept = prepared.kept();
        // Many rows per statement: one statement per finding costs a round trip and an execution each.
        for (int from = 0; from < kept.size(); from += ROWS_PER_INSERT) {
            List<Finding> rows = kept.subList(from, Math.min(kept.size(), from + ROWS_PER_INSERT));
            jdbc.update(insert(rows.size()), ps -> {
                int column = 1;
                for (Finding finding : rows) {
                    column = bind(ps, column, runId, finding);
                }
            });
        }
        return prepared.counts();
    }

    /** Counts {@code findings} and applies the caps (a pure computation: the database isn't touched). */
    public Prepared prepare(List<Finding> findings) {
        int errors = 0;
        int warnings = 0;
        Map<QualityCategory, Integer> byCategory = new EnumMap<>(QualityCategory.class);
        for (Finding finding : findings) {
            if (finding.isError()) {
                errors++;
            } else {
                warnings++;
            }
            byCategory.merge(finding.category(), 1, Integer::sum);
        }

        List<Finding> ordered = new ArrayList<>(findings);
        ordered.sort(Comparator.comparing((Finding f) -> f.isError() ? 0 : 1)
                .thenComparing(f -> f.output().path())
                .thenComparing(Finding::code));
        int perOutput = Math.max(0, properties.getMaxFindingsPerOutput());
        int perRun = Math.max(0, properties.getMaxFindingsPerRun());
        Map<String, Integer> byRuleAndOutput = new HashMap<>();
        List<Finding> kept = new ArrayList<>();
        for (Finding finding : ordered) {
            if (kept.size() >= perRun) {
                break;
            }
            int n = byRuleAndOutput.merge(finding.code() + "\n" + finding.output().path(), 1, Integer::sum);
            if (n <= perOutput) {
                kept.add(finding);
            }
        }

        return new Prepared(new Counts(errors, warnings, byCategory, findings.size() - kept.size()), kept);
    }

    /** {@code INSERT} of {@code rows} findings. */
    private static String insert(int rows) {
        return rows == ROWS_PER_INSERT ? INSERT_FULL : INSERT_PREFIX + String.join(", ", Collections.nCopies(rows, ROW));
    }

    /** Binds {@code finding}'s columns from parameter {@code column} on; returns the next free parameter. */
    private static int bind(PreparedStatement ps, int column, long runId, Finding finding) throws SQLException {
        OutputKey key = finding.output();
        ps.setLong(column, runId);
        ps.setObject(column + 1, key.asset());
        ps.setString(column + 2, key.channel());
        ps.setString(column + 3, key.locale());
        if (key.pageNumber() == null) {
            ps.setNull(column + 4, Types.INTEGER);
        } else {
            ps.setInt(column + 4, key.pageNumber());
        }
        ps.setString(column + 5, truncate(key.path(), MAX_PATH));
        ps.setString(column + 6, finding.code());
        ps.setString(column + 7, finding.category().name());
        ps.setString(column + 8, finding.severity().name());
        ps.setString(column + 9, truncate(finding.message(), MAX_MESSAGE));
        ps.setString(column + 10, truncate(finding.selector(), MAX_SELECTOR));
        ps.setString(column + 11, truncate(finding.sectionInstanceId(), MAX_SECTION));
        ps.setBoolean(column + 12, finding.carried());
        return column + COLUMNS;
    }

    // ------------------------------------------------------------------
    // Read
    // ------------------------------------------------------------------

    /**
     * Which findings to list; {@code null} (or empty) fields don't filter.
     *
     * @param codes any of these codes
     * @param pathPrefix output paths starting with this (literally, no wildcards)
     */
    public record Filter(
            QualitySeverity severity,
            QualityCategory category,
            Set<String> codes,
            UUID assetUuid,
            String channel,
            String locale,
            String pathPrefix) {

        public static final Filter NONE = new Filter(null, null, null, null, null, null, null);

        Filter withoutSeverity() {
            return new Filter(null, category, codes, assetUuid, channel, locale, pathPrefix);
        }

        Filter withoutCategory() {
            return new Filter(severity, null, codes, assetUuid, channel, locale, pathPrefix);
        }

        Filter withoutCodes() {
            return new Filter(severity, category, null, assetUuid, channel, locale, pathPrefix);
        }

        Filter withoutLocale() {
            return new Filter(severity, category, codes, assetUuid, channel, null, pathPrefix);
        }
    }

    /** A {@code WHERE} clause over {@code generation_run_finding f} and its arguments. */
    private record Where(String sql, List<Object> args) {}

    private static Where where(long runId, Filter filter) {
        StringBuilder where = new StringBuilder(" WHERE f.run_id = ?");
        List<Object> args = new ArrayList<>();
        args.add(runId);
        if (filter.severity() != null) {
            where.append(" AND f.severity = ?");
            args.add(filter.severity().name());
        }
        if (filter.category() != null) {
            where.append(" AND f.category = ?");
            args.add(filter.category().name());
        }
        if (filter.codes() != null && !filter.codes().isEmpty()) {
            where.append(" AND f.code IN (").append(String.join(", ", filter.codes().stream().map(c -> "?").toList()))
                    .append(')');
            args.addAll(filter.codes().stream().sorted().toList());
        }
        if (filter.assetUuid() != null) {
            where.append(" AND f.asset_uuid = ?");
            args.add(filter.assetUuid());
        }
        if (filter.channel() != null) {
            where.append(" AND f.channel = ?");
            args.add(filter.channel());
        }
        if (filter.locale() != null) {
            where.append(" AND f.locale = ?");
            args.add(filter.locale());
        }
        if (filter.pathPrefix() != null && !filter.pathPrefix().isEmpty()) {
            where.append(" AND f.output_path LIKE ? ESCAPE '!'");
            args.add(filter.pathPrefix().replace("!", "!!").replace("%", "!%").replace("_", "!_") + "%");
        }
        return new Where(where.toString(), args);
    }

    /** One rule code and how many findings it has. */
    public record CodeCount(String code, long count) {}

    /**
     * Facet counts over the stored findings of a run (M35.24): every facet counts the findings passing <em>all the
     * other</em> filters (its own is left out), so choosing a value never empties the other values of its own facet and
     * the other facets react to it.
     *
     * @param total findings passing every filter (the size of the filtered list)
     * @param severity {@code WARNING} and {@code ERROR}, both always present (possibly 0)
     * @param category {@code LINKS}, {@code SEO} and {@code ACCESSIBILITY}, all always present (possibly 0)
     * @param codes the rule codes with at least one finding, by code
     * @param locale the languages with at least one finding, by language; findings of a project without languages
     *     are in none
     */
    public record Facets(
            long total,
            Map<QualitySeverity, Long> severity,
            Map<QualityCategory, Long> category,
            List<CodeCount> codes,
            Map<String, Long> locale) {}

    /** The facet counts of run {@code runId}'s findings for {@code filter}. */
    @Transactional(readOnly = true)
    public Facets facets(long runId, Filter filter) {
        Where all = where(runId, filter);
        Long total = jdbc.queryForObject(
                "SELECT COUNT(*) FROM generation_run_finding f" + all.sql(), Long.class, all.args().toArray());

        Map<QualitySeverity, Long> severity = new EnumMap<>(QualitySeverity.class);
        severity.put(QualitySeverity.WARNING, 0L);
        severity.put(QualitySeverity.ERROR, 0L);
        Where bySeverity = where(runId, filter.withoutSeverity());
        jdbc.query("SELECT f.severity, COUNT(*) FROM generation_run_finding f" + bySeverity.sql() + " GROUP BY f.severity",
                (RowCallbackHandler) rs -> {
                    QualitySeverity value = QualitySeverity.parse(rs.getString(1));
                    if (value != null && value != QualitySeverity.OFF) {
                        severity.put(value, rs.getLong(2));
                    }
                },
                bySeverity.args().toArray());

        Map<QualityCategory, Long> category = new EnumMap<>(QualityCategory.class);
        for (QualityCategory value : QualityCategory.values()) {
            category.put(value, 0L);
        }
        Where byCategory = where(runId, filter.withoutCategory());
        jdbc.query("SELECT f.category, COUNT(*) FROM generation_run_finding f" + byCategory.sql() + " GROUP BY f.category",
                (RowCallbackHandler) rs -> {
                    QualityCategory value = QualityCategory.parse(rs.getString(1));
                    if (value != null) {
                        category.put(value, rs.getLong(2));
                    }
                },
                byCategory.args().toArray());

        Where byCode = where(runId, filter.withoutCodes());
        List<CodeCount> codes = jdbc.query(
                "SELECT f.code, COUNT(*) FROM generation_run_finding f" + byCode.sql() + " GROUP BY f.code ORDER BY f.code",
                (rs, i) -> new CodeCount(rs.getString(1), rs.getLong(2)),
                byCode.args().toArray());

        Map<String, Long> locale = new TreeMap<>();
        Where byLocale = where(runId, filter.withoutLocale());
        jdbc.query("SELECT f.locale, COUNT(*) FROM generation_run_finding f" + byLocale.sql()
                        + " AND f.locale IS NOT NULL GROUP BY f.locale",
                (RowCallbackHandler) rs -> {
                    locale.put(rs.getString(1), rs.getLong(2));
                },
                byLocale.args().toArray());

        return new Facets(total == null ? 0 : total, severity, category, codes, locale);
    }

    /** The findings of run {@code runId} per rule code, over every stored finding. */
    @Transactional(readOnly = true)
    public Map<String, Long> countsByCode(long runId) {
        Map<String, Long> counts = new TreeMap<>();
        jdbc.query("SELECT code, COUNT(*) FROM generation_run_finding WHERE run_id = ? GROUP BY code",
                (RowCallbackHandler) rs -> {
                    counts.put(rs.getString(1), rs.getLong(2));
                },
                runId);
        return counts;
    }

    /** The current display names of the pages {@code assetUuids} of the project; a deleted page has none. */
    @Transactional(readOnly = true)
    public Map<UUID, String> displayNames(long projectId, Collection<UUID> assetUuids) {
        Map<UUID, String> names = new HashMap<>();
        List<UUID> ids = List.copyOf(assetUuids);
        for (int from = 0; from < ids.size(); from += 500) {
            List<UUID> chunk = ids.subList(from, Math.min(ids.size(), from + 500));
            List<Object> args = new ArrayList<>();
            args.add(projectId);
            args.addAll(chunk);
            jdbc.query(
                    "SELECT a.uuid, v.display_name FROM asset a"
                            + " JOIN asset_version v ON v.asset_id = a.id AND v.valid_to_revision IS NULL AND v.deleted = FALSE"
                            + " WHERE a.project_id = ? AND a.uuid IN ("
                            + String.join(", ", Collections.nCopies(chunk.size(), "?")) + ")",
                    (RowCallbackHandler) rs -> {
                        names.put(rs.getObject(1, UUID.class), rs.getString(2));
                    },
                    args.toArray());
        }
        return names;
    }

    /**
     * One stored finding with the page it is on as it is named now.
     *
     * @param uid the asset's current uid; {@code null} when it was deleted since
     * @param displayName the asset's current display name; {@code null} when it was deleted since
     */
    public record StoredFinding(
            long id,
            UUID assetUuid,
            String uid,
            String displayName,
            String channel,
            String locale,
            Integer pageNumber,
            String outputPath,
            String code,
            QualityCategory category,
            QualitySeverity severity,
            String message,
            String selector,
            String sectionInstanceId,
            boolean carried) {}

    /** A page of run {@code runId}'s findings passing {@code filter}, by output path, then code. */
    @Transactional(readOnly = true)
    public Page<StoredFinding> page(long projectId, long runId, Filter filter, Pageable pageable) {
        Where built = where(runId, filter);
        String where = built.sql();
        List<Object> args = built.args();
        Long total = jdbc.queryForObject(
                "SELECT COUNT(*) FROM generation_run_finding f" + where, Long.class, args.toArray());

        List<Object> pageArgs = new ArrayList<>();
        pageArgs.add(projectId);
        pageArgs.addAll(args);
        String paging = "";
        if (pageable.isPaged()) {
            paging = " LIMIT ? OFFSET ?";
            pageArgs.add(pageable.getPageSize());
            pageArgs.add(pageable.getOffset());
        }
        List<StoredFinding> rows = jdbc.query(
                """
                SELECT f.id, f.asset_uuid, a.uid, v.display_name, f.channel, f.locale, f.page_number, f.output_path,
                       f.code, f.category, f.severity, f.message, f.selector, f.section_instance_id, f.carried
                FROM generation_run_finding f
                LEFT JOIN asset a ON a.uuid = f.asset_uuid AND a.project_id = ?
                LEFT JOIN asset_version v ON v.asset_id = a.id AND v.valid_to_revision IS NULL AND v.deleted = FALSE
                """
                        + where
                        + " ORDER BY f.output_path, f.code, f.id"
                        + paging,
                RunFindingStore::row,
                pageArgs.toArray());
        return new PageImpl<>(rows, pageable, total == null ? 0 : total);
    }

    private static StoredFinding row(ResultSet rs, int rowNum) throws SQLException {
        int number = rs.getInt("page_number");
        Integer pageNumber = rs.wasNull() ? null : number;
        // A deleted page (no open, undeleted version) is named by nothing: uid and display name are both null.
        String displayName = rs.getString("display_name");
        return new StoredFinding(
                rs.getLong("id"),
                rs.getObject("asset_uuid", UUID.class),
                displayName == null ? null : rs.getString("uid"),
                displayName,
                rs.getString("channel"),
                rs.getString("locale"),
                pageNumber,
                rs.getString("output_path"),
                rs.getString("code"),
                QualityCategory.parse(rs.getString("category")),
                QualitySeverity.parse(rs.getString("severity")),
                rs.getString("message"),
                rs.getString("selector"),
                rs.getString("section_instance_id"),
                rs.getBoolean("carried"));
    }

    /** Deletes the findings of {@code runIds} (run retention deletes them with their runs). */
    @Transactional
    public void deleteForRuns(List<Long> runIds) {
        if (runIds.isEmpty()) {
            return;
        }
        String in = String.join(",", runIds.stream().map(String::valueOf).toList());
        jdbc.update("DELETE FROM generation_run_finding WHERE run_id IN (" + in + ")");
    }

    private static String truncate(String value, int max) {
        return value == null || value.length() <= max ? value : value.substring(0, max);
    }
}
