package com.acme.staticforge.scheduler;

import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import org.springframework.jdbc.core.JdbcTemplate;

/**
 * Claims rows of a table for one node with a conditional update (M27.4.1, epic decision 20): portable across H2 and
 * PostgreSQL, safe with several nodes polling the same table, no {@code SELECT … FOR UPDATE SKIP LOCKED}. Only the
 * node whose update changed a row owns it; the lease expires unless the owner extends it, so a crashed node's row is
 * claimed again after {@code lease}.
 *
 * <p>The table needs a key column, {@code version}, {@code lease_owner} and {@code lease_until}. Scheduled actions are
 * keyed by {@code id}; the instance jobs of M29 ({@code system_job}) by their string {@code key} (M29.1.1), so the key
 * column is configurable and a key is any value the JDBC driver binds ({@code Long}, {@code String}).
 */
public class LeaseClaimer {

    private final JdbcTemplate jdbc;
    private final String claimSql;
    private final String extendSql;
    private final String releaseSql;

    /**
     * A claimer of rows keyed by {@code id}.
     *
     * @param table the table whose rows are claimed (a constant, never user input)
     * @param claimedAssignments extra {@code SET} assignments of a successful claim (e.g. {@code status = 'RUNNING'}),
     *     or {@code null}
     */
    public LeaseClaimer(JdbcTemplate jdbc, String table, String claimedAssignments) {
        this(jdbc, table, "id", claimedAssignments);
    }

    /**
     * @param table the table whose rows are claimed (a constant, never user input)
     * @param keyColumn the column identifying a row, quoted when it is a reserved word (e.g. {@code "key"})
     * @param claimedAssignments extra {@code SET} assignments of a successful claim, or {@code null}
     */
    public LeaseClaimer(JdbcTemplate jdbc, String table, String keyColumn, String claimedAssignments) {
        this.jdbc = jdbc;
        String extra = claimedAssignments == null || claimedAssignments.isBlank() ? "" : ", " + claimedAssignments;
        this.claimSql = "UPDATE " + table + " SET lease_owner = ?, lease_until = ?, version = version + 1" + extra
                + " WHERE " + keyColumn + " = ? AND version = ? AND (lease_until IS NULL OR lease_until < ?)";
        this.extendSql = "UPDATE " + table + " SET lease_until = ? WHERE " + keyColumn + " = ? AND lease_owner = ?";
        this.releaseSql = "UPDATE " + table + " SET lease_owner = NULL, lease_until = NULL WHERE " + keyColumn
                + " = ? AND lease_owner = ?";
    }

    /**
     * Claims row {@code key} as read at {@code version} for {@code owner} until {@code until}. {@code true} only for
     * the one caller whose update changed the row; the row's version is then {@code version + 1}.
     */
    public boolean claim(Object key, long version, String owner, Instant until, Instant now) {
        return jdbc.update(claimSql, owner, utc(until), key, version, utc(now)) == 1;
    }

    /** Moves the lease of a row this {@code owner} holds to {@code until}; {@code false} when it lost the row. */
    public boolean extend(Object key, String owner, Instant until) {
        return jdbc.update(extendSql, utc(until), key, owner) == 1;
    }

    /**
     * Lets go of a row this {@code owner} holds without touching anything else (a node shutting down mid-work);
     * {@code false} when it no longer held it.
     */
    public boolean release(Object key, String owner) {
        return jdbc.update(releaseSql, key, owner) == 1;
    }

    private static OffsetDateTime utc(Instant instant) {
        return OffsetDateTime.ofInstant(instant, ZoneOffset.UTC);
    }
}
