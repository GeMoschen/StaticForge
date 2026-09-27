# Security review — StaticForge CMS backend

**Scope:** §26.3 security controls, §26.4 observability, §25.7 dependency-check & coverage gates.
**Status:** M7.3.1 / M7.3.2. Last reviewed: 2026-08-21.

This document maps each §26.3 control to its concrete implementation, citing file paths, and flags
honest gaps. It also records the dependency-check and OpenTelemetry follow-up wiring.

---

## 1. §26.3 control checklist

Legend: ✅ implemented, ⚠️ partial, ➖ not applicable (given v1 scope).

| # | §26.3 control | Status | Evidence |
|---|---|---|---|
| Transport (TLS 1.3, HSTS, secure cookies) | ⚠️ | Terminated at the edge proxy (Nginx per §26.6), not in the backend. Cookies: refresh token is `HttpOnly; Secure; SameSite=Strict` (`RefreshCookieService`). HSTS/TLS 1.3 are infra config — see `infra/`. Backend does not terminate TLS. |
| Auth (BCrypt cost 12, lockout, refresh rotation + reuse detection) | ✅ | `PasswordService` — `BCryptPasswordEncoder(12)`. `LoginAttemptService` — 10/5 min per (IP,user), 15-failure lockout 30 min. `RefreshTokenService` — rotation + family reuse detection (`refresh_token.family_id`, `revoked`). `AuthService` orchestrates. |
| AuthZ (per-project role on every endpoint, deny-by-default, no project-existence leak) | ✅ | `SecurityConfig` — `anyRequest().authenticated()` (deny-by-default). `ProjectAuthorizationService.has(projectKey, role)` throws 404 for non-members (`projectAuth.has(...)` SpEL). `@PreAuthorize` on every mutating controller. |
| Injection (parameterized JPQL/SQL only) | ✅ | `RevisionRepository.findFiltered` uses `@Query` with `:param` only. No string-built queries anywhere. OCTL has no Java/reflection/I/O surface (§16.1); render is a total language (`OctlRenderer`). |
| XSS (channel-default escaping, TipTap schema, sanitizer, strict CSP on preview) | ✅ | OCTL escaping by channel `default_escaping` (`Escaping`, `Filters`, `GenerationRenderer.escapingFor`). SVG sanitizer (`SvgSanitizer`) strips script/foreignObject/event attrs. Preview served under `Content-Security-Policy: sandbox allow-scripts` + `nosniff` (`PreviewController`). TipTap schema is frontend. |
| Upload (Tika sniff, allow-list, size cap, SVG strip, EXIF strip, non-executable storage) | ✅ | `MediaServiceImpl` — `Tika.detect` (client MIME never trusted), `requireAllowed` allow-list, `checkSize` (413), `strip` (EXIF re-encode + SVG sanitize). Content-addressed blobs keyed by SHA-256 (`FilesystemBlobStore`), served as `attachment` for non-renderable types. |
| SSRF (no server-side fetch of user URLs in v1) | ➖ | No server-side HTTP client in the runtime code. The only `java.net.http.HttpClient` is `tooling/OpenApiGeneratorMain` (dev-only, fetches its own `localhost`). No feature fetches user-supplied URLs. Unchanged by M30: the build-time link checks (`generate/quality/LinkResolver`) resolve links against the build's own outputs and skip every external URL; redirect targets (`redirect/RedirectPaths`) are validated (`http(s)` only, no `..`, no `//host`) and written into stubs/`.htaccess`/`redirects.json`, never fetched. |
| Path traversal (normalize + `..` reject, stay under target root) | ✅ | `OutputFile.normalize` rejects `..`/`.` segments and leading slashes; target writers `root.resolve(...).normalize()` (`TargetIo`, `FilesystemTargetWriter`). M30 redirects: source and target paths are normalized and `..` refused on every write (`RedirectPaths`, `422 SF-DOM-0193`); stubs are ordinary `OutputFile`s. `.htaccess` lines escape the source as a regex and the target against mod_alias substitution (`HtaccessPostProcessor`); stub values are HTML-attribute- and JS-escaped (`HtmlStubPostProcessor`). |
| Secrets (env/secret-manager only) | ✅ | `application*.yml` references `${SF_JWT_SECRET}`, `${DB_USER}`, `${DB_PASSWORD}` etc.; no secrets in source or logs (no `password` logged). |
| Audit (`audit_log` covers auth, membership, channel, target; + revisions for content) | ✅ | `audit_log` table (`011-audit-log.xml`) + `AuditService`. Wired: `AuthService` (login success/failure), `ProjectServiceImpl` (`MEMBER_ROLE_SET`/`MEMBER_REMOVED`), `ChannelServiceImpl` (`CHANNEL_CREATE/UPDATE/DELETE`), `TargetController` (`TARGET_CREATE/UPDATE/DELETE`). Content changes already covered by the revision trail (`revision` table). Read endpoint: `GET /api/v1/projects/{projectKey}/audit` (`AuditController`, `PROJECT_ADMIN`). |
| Rate limits (login, preview render, generation start) | ⚠️ | Login fully implemented (`LoginAttemptService`). Preview render and generation-start rate limiting are **not yet implemented** — flagged gap. |
| Headers (CSP, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`) | ⚠️ | Preview adds CSP + `nosniff` (`PreviewController`). There is **no global response-header filter** for the API/static output (`Referrer-Policy`, `Permissions-Policy`). Recommend a `OncePerRequestFilter` or Nginx header layer — flagged gap. |

### Gaps (flagged for follow-up)
1. **Rate limiting** for preview render and generation start (§26.3) — only login is done.
2. **Global security headers** (`Referrer-Policy`, `Permissions-Policy`, plus a global `X-Content-Type-Options`) — only preview is covered.
3. **TLS/HSTS** are edge-proxy concerns and must be enforced in the Nginx/infra layer (§26.6), not the backend.
4. **JWT signing** uses HS256 in dev; RS256 + JWKS + two-key rotation is a documented follow-up (see `SecurityConfig` TODO, §9.3). `prod` profile selects RS256 but key-store wiring is deferred.

---

## 2. Dependency-check (§25.7)

The OWASP `dependency-check` Gradle plugin is **not** applied to the root `plugins` block. Doing so would force
a plugin + NVD download at configuration time and break offline builds; the CI-workflow agent owns that wiring.

**Intended wiring (CI/nightly only):**

```kotlin
// root build.gradle.kts — added by the CI agent in a `ci`-only build (not default):
plugins { id("org.owasp.dependencycheck") version "12.1.0" }
tasks.dependencyCheck { failBuildOnCVSS = 7.0 }
```

**Local command (once the plugin is present):**

```bash
./gradlew dependencyCheckAnalyze
```

Gate: no `HIGH`/`CRITICAL` finding without a documented, time-boxed exception (§25.7).
Recommended cadence: nightly scheduled job + a PR-blocking run on dependency-file changes.

---

## 3. Observability status & tracing follow-up (§26.4)

### 3.1 Configured now
- **Actuator**: `management.endpoints.web.exposure.include=health,info,metrics,prometheus`; `health.show-details=when_authorized`;
  `health.probes.enabled=true` (`application.yml`). `spring-boot-starter-actuator` + `micrometer-registry-prometheus` on `sf-app`.
- **Health indicators**: Liquibase/DB (`DataSourceHealthIndicator`), disk space, and the new
  `BlobStoreHealthIndicator` (filesystem backend reports UP only when its root is writable; the S3 v1 placeholder reports DOWN).
- **Metrics** (Micrometer, explicit `MeterRegistry` records — no AOP config):
  - `sf.revision.allocate` — counter (revision allocation).
  - `sf.render.duration` — timer, tags `{template, channel}` (render pipeline).
  - `sf.generation.duration` — timer, tag `{mode}` (FULL/INCREMENTAL).
  - `sf.generation.files` — counter, tag `{mode}`.
  - `sf.media.upload.bytes` — counter (bytes uploaded).
  - `sf.quality.check.duration` — timer (the CHECK stage per build, M30).
  - `sf.quality.findings` — counter, tags `{severity, category}` (quality findings per build, M30).
  - HTTP histograms: `http.server.requests` (provided automatically by Spring Boot web autoconfiguration).

### 3.2 Deferred — OpenTelemetry tracing
OpenTelemetry SDK wireup is intentionally **not** added to the default build (offline-safety; no new external deps).
When enabling distributed tracing, the intended wiring is:

```kotlin
// sf-app (opt-in profile `withTracing`, or CI-injected):
implementation("io.opentelemetry.instrumentation:opentelemetry-spring-boot-starter")
```

- Propagate `traceId`, `projectKey`, `revision`, `userId` into structured JSON logs (Micrometer Tracing + Logback
  pattern using `%X{traceId}`).
- Spans: `request → controller → service → render pipeline → generation run`; tag render spans with the same
  `template`/`channel` tags as `sf.render.duration`.

### 3.3 Alert rules (§26.4)
- Generation failure rate > 5% over 15 min → page/notify.
- p95 content-save latency (`http.server.requests[uri=/api/v1/projects/*]`) > 120 ms sustained.
- `refresh_token` reuse detections (family invalidation) → immediate security alert.
- Blob-store disk headroom < 10% (or `< N` GB) → warning/critical (feed from the blob-store health indicator).

---

## 4. Coverage gate (§25.7)

Configured as `jacocoAggregateReport` + a standalone `jacocoCoverageGate` task in the root `build.gradle.kts`
(line ≥ 80%, branch ≥ 70%, `render`/`revision` packages ≥ 90%). It is **not** wired into `check` yet — see the
build file comment and the agent report for current-vs-target numbers and the decision on promoting it to the
`check` lifecycle.
