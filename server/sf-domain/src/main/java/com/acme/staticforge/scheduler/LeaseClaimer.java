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
 * <p>The table needs {@code id}, {@code version}, {@code lease_owner} and {@code lease_until}. Kept independent of
 * scheduled actions so the instance jobs of M29 claim their rows the same way.
 */
public class LeaseClaimer {

    private final JdbcTemplate jdbc;
    private final String claimSql;
    private final String extendSql;

    /**
     * @param table the table whose rows are claimed (a constant, never user input)
     * @param claimedAssignments extra {@code SET} assignments of a successful claim (e.g. {@code status = 'RUNNING'}),
     *     or {@code null}
     */
    public LeaseClaimer(JdbcTemplate jdbc, String table, String claimedAssignments) {
        this.jdbc = jdbc;
        String extra = claimedAssignments == null || claimedAssignments.isBlank() ? "" : ", " + claimedAssignments;
        this.claimSql = "UPDATE " + table + " SET lease_owner = ?, lease_until = ?, version = version + 1" + extra
                + " WHERE id = ? AND version = ? AND (lease_until IS NULL OR lease_until < ?)";
        this.extendSql = "UPDATE " + table + " SET lease_until = ? WHERE id = ? AND lease_owner = ?";
    }

    /**
     * Claims row {@code id} as read at {@code version} for {@code owner} until {@code until}. {@code true} only for the
     * one caller whose update changed the row; the row's version is then {@code version + 1}.
     */
    public boolean claim(long id, long version, String owner, Instant until, Instant now) {
        return jdbc.update(claimSql, owner, utc(until), id, version, utc(now)) == 1;
    }

    /** Moves the lease of a row this {@code owner} holds to {@code until}; {@code false} when it lost the row. */
    public boolean extend(long id, String owner, Instant until) {
        return jdbc.update(extendSql, utc(until), id, owner) == 1;
    }

    private static OffsetDateTime utc(Instant instant) {
        return OffsetDateTime.ofInstant(instant, ZoneOffset.UTC);
    }
}
