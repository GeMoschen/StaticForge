---
id: M0.2.1
status: done
depends: [M0.1.1]
epic: m0-skeleton
feature: backend-bootstrap
area: backend
---

# M0.2.1 — Spring Boot application & configuration

## Context

`sf-app` is the single runnable artifact. Bootstrap it with the dependency set and
configuration from §4.2 and §21.6.

## Goals

- Create `sf-app` with `@SpringBootApplication`, `@ComponentScan`/`@EntityScan` scoped
  to `com.acme.staticforge`.
- Add the starter set: `spring-boot-starter-web`, `spring-boot-starter-validation`,
  `spring-boot-starter-data-jpa`, `spring-boot-starter-actuator`, and
  `spring-boot-starter-security` (skeleton), plus Liquibase.
- Provide `application.yml` + `application-{dev,test,demo,prod}.yml` matching §21.6:
  datasource/Hikari, JPA (`ddl-auto: validate`, `open-in-view: false`, batch size 50),
  Liquibase changelog path, `spring.threads.virtual.enabled: true`, and the `sf.*`
  config tree (security.jwt, media, generate, revision).
- Use environment-variable placeholders for secrets (§26.3).

## Acceptance criteria

- [ ] `./gradlew :server:sf-app:bootRun` and `./gradlew :server:sf-app:bootJar` work.
- [ ] App starts (against an available DB or H2) and `ddl-auto: validate` passes once
      the changelog exists (coordinated with feature `database-liquibase`).
- [ ] `application.yml` is the single source of `sf.*` defaults; `prod` never uses
      `HS256`/dev-only values.

## Out of scope

- Actual security rules beyond a stub that permits health endpoints.
- Business endpoints.

## Notes / hazards

- `ddl-auto: validate` is mandatory in every profile (§21.6). Until Liquibase ships,
  the app may fail to boot against Postgres; the H2 `test` profile is the interim path.
