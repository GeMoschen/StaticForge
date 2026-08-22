package com.acme.staticforge.revision;

import org.springframework.jdbc.core.ConnectionCallback;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

/**
 * JDBC-backed {@link RevisionCounterRepository}. A single implementation selects the
 * database strategy from the JDBC metadata: PostgreSQL uses {@code UPDATE … RETURNING}
 * (§7.3), everything else falls back to a {@code SELECT … FOR UPDATE} + {@code UPDATE}
 * pair (the H2 path, §7.3 note).
 */
@Repository
public class JdbcRevisionCounterRepository implements RevisionCounterRepository {

    private final JdbcTemplate jdbcTemplate;
    private volatile Boolean postgres;

    public JdbcRevisionCounterRepository(JdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
    }

    @Override
    public long nextRevision(long projectId) {
        if (isPostgres()) {
            Long next = jdbcTemplate.queryForObject(
                    "UPDATE project_revision_counter "
                            + "SET next_revision = next_revision + 1 WHERE project_id = ? "
                            + "RETURNING next_revision - 1",
                    Long.class,
                    projectId);
            return next;
        }

        Long current = jdbcTemplate.queryForObject(
                "SELECT next_revision FROM project_revision_counter WHERE project_id = ? FOR UPDATE",
                Long.class,
                projectId);
        jdbcTemplate.update(
                "UPDATE project_revision_counter SET next_revision = ? WHERE project_id = ?", current + 1, projectId);
        return current;
    }

    @Override
    public void initialize(long projectId) {
        jdbcTemplate.update(
                "INSERT INTO project_revision_counter (project_id, next_revision) VALUES (?, ?)", projectId, 1L);
    }

    private boolean isPostgres() {
        Boolean p = postgres;
        if (p == null) {
            p = jdbcTemplate.execute(
                    (ConnectionCallback<Boolean>) con -> con.getMetaData().getDatabaseProductName().contains("PostgreSQL"));
            postgres = p;
        }
        return p;
    }
}
