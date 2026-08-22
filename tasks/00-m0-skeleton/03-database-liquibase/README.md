# Feature: Database, Liquibase & Hibernate baseline

**Spec:** §22 (entire), §25.2 (H2 in tests).
**Area:** backend. **Epic:** M0.

## Goal

Establish the Liquibase-owned schema foundation, Hibernate mapping strategy (including
the portable JSON/`jsonb` column), and the H2 PostgreSQL-compatibility test harness, so
that M1 can add entities on stable ground.

## Tasks (in order)

| # | Task | Depends |
|---|---|---|
| 1 | [001-liquibase-scaffold.md](001-liquibase-scaffold.md) | M0.2.1 |
| 2 | [002-hibernate-mapping.md](002-hibernate-mapping.md) | 1 |
| 3 | [003-h2-test-harness.md](003-h2-test-harness.md) | 1 |

## Feature exit criteria

- [ ] `db.changelog-master.xml` + `includeAll` over versioned changeset dirs run clean
      on both Postgres and H2.
- [ ] A `jsonb`/`clob` payload column is created dbms-scoped (§22.4) and mapped by
      Hibernate `@JdbcTypeCode(SqlTypes.JSON)`.
- [ ] `@DataJpaTest` slice tests run against H2 with `ddl-auto: validate` and pass.

## Dependencies

`M0:backend-bootstrap` (app boot + config).
