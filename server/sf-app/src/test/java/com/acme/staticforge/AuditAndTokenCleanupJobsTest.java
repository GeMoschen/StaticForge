package com.acme.staticforge;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.acme.staticforge.common.SfException;
import com.acme.staticforge.housekeeping.JobOutcome;
import com.acme.staticforge.housekeeping.JobTrigger;
import com.acme.staticforge.housekeeping.SystemJobRun;
import com.acme.staticforge.housekeeping.SystemJobRunRepository;
import com.acme.staticforge.housekeeping.SystemJobRunner;
import com.acme.staticforge.housekeeping.audit.AuditPurgeJob;
import com.acme.staticforge.housekeeping.tokens.RefreshTokenCleanupJob;
import com.acme.staticforge.project.Project;
import com.acme.staticforge.security.RefreshToken;
import com.acme.staticforge.security.RefreshTokenRepository;
import com.acme.staticforge.security.RefreshTokenService;
import com.acme.staticforge.user.AppUser;
import java.time.Duration;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;

/**
 * The {@code audit-purge} and {@code refresh-token-cleanup} jobs (M29.2.4) through the application's runner: the
 * retention boundary and dry run of the purge, and which refresh-token families the cleanup removes — never a live one,
 * so reuse detection keeps working.
 */
@SpringBootTest
@ActiveProfiles("test")
class AuditAndTokenCleanupJobsTest {

    private static final AtomicInteger SEQ = new AtomicInteger();

    @Autowired SystemJobRunner runner;
    @Autowired SystemJobRunRepository runs;
    @Autowired JdbcTemplate jdbc;
    @Autowired com.acme.staticforge.user.UserService userService;
    @Autowired com.acme.staticforge.project.ProjectService projectService;
    @Autowired com.acme.staticforge.asset.AssetService assetService;
    @Autowired RefreshTokenService tokens;
    @Autowired RefreshTokenRepository tokenRows;

    @Test
    @DisplayName("audit purge: entries at 366 days go, at 364 days stay; instance and project entries; dry run counts match")
    void auditPurge() {
        int n = SEQ.incrementAndGet();
        AppUser user = fixtures().user("purge-" + n + "-" + System.nanoTime());
        Project project = fixtures().project("purge" + n + "x" + (System.nanoTime() % 100_000), user);
        String oldAction = "TEST_PURGE_OLD_" + n;
        String keptAction = "TEST_PURGE_KEPT_" + n;
        Instant now = Instant.now();
        long oldInstance = audit(null, oldAction, now.minus(Duration.ofDays(366)));
        long oldProject = audit(project.getId(), oldAction, now.minus(Duration.ofDays(366)));
        long keptInstance = audit(null, keptAction, now.minus(Duration.ofDays(364)));
        long keptProject = audit(project.getId(), keptAction, now.minus(Duration.ofDays(364)));

        SystemJobRun dry = run(AuditPurgeJob.KEY, true);
        assertThat(dry.getOutcome()).isEqualTo(JobOutcome.SUCCEEDED);
        assertThat(dry.isDryRun()).isTrue();
        assertThat(dry.getReport().path("byAction").path(oldAction).asLong()).isEqualTo(2);
        assertThat(dry.getReport().path("byAction").has(keptAction)).isFalse();
        assertThat(dry.getReport().path("instanceEntries").asLong()).isGreaterThanOrEqualTo(1);
        assertThat(dry.getReport().path("projectEntries").asLong()).isGreaterThanOrEqualTo(1);
        assertThat(dry.getReport().path("oldestRemaining").asText()).isNotBlank();
        assertThat(exists(oldInstance)).isTrue();
        assertThat(exists(oldProject)).isTrue();

        SystemJobRun real = run(AuditPurgeJob.KEY, false);
        assertThat(real.getOutcome()).isEqualTo(JobOutcome.SUCCEEDED);
        assertThat(real.getItemsAffected()).isEqualTo(dry.getItemsAffected()).isGreaterThanOrEqualTo(2);
        assertThat(real.getReport().path("byAction").path(oldAction).asLong()).isEqualTo(2);
        assertThat(exists(oldInstance)).isFalse();
        assertThat(exists(oldProject)).isFalse();
        assertThat(exists(keptInstance)).isTrue();
        assertThat(exists(keptProject)).isTrue();
        Instant oldestRemaining = Instant.parse(real.getReport().path("oldestRemaining").asText());
        assertThat(oldestRemaining).isAfter(now.minus(Duration.ofDays(365)));
    }

    @Test
    @DisplayName("refresh-token cleanup keeps live families (reuse detection still works) and deletes dead ones")
    void refreshTokenCleanup() {
        AppUser user = fixtures().user("tokens-" + SEQ.incrementAndGet() + "-" + System.nanoTime());
        Instant now = Instant.now();

        // A live family: its first token rotated (revoked), the second one usable.
        RefreshToken liveFirst = tokens.issue(user.getId());
        tokens.rotate(liveFirst.getToken());
        // Past the absolute expiry.
        RefreshToken absolute = tokens.issue(user.getId());
        tokens.rotate(absolute.getToken());
        setExpiry(absolute.getFamilyId(), now.minus(Duration.ofHours(1)), now.minus(Duration.ofMinutes(1)));
        // Every row expired for longer than the reuse window (7 days).
        RefreshToken expiredLong = tokens.issue(user.getId());
        tokens.rotate(expiredLong.getToken());
        setExpiry(expiredLong.getFamilyId(), now.minus(Duration.ofDays(8)), now.plus(Duration.ofDays(10)));
        // Expired, but within the reuse window: still recognized as reuse.
        RefreshToken expiredRecently = tokens.issue(user.getId());
        tokens.rotate(expiredRecently.getToken());
        setExpiry(expiredRecently.getFamilyId(), now.minus(Duration.ofDays(1)), now.plus(Duration.ofDays(10)));

        SystemJobRun run = run(RefreshTokenCleanupJob.KEY, false);
        assertThat(run.getOutcome()).isEqualTo(JobOutcome.SUCCEEDED);
        assertThat(run.getItemsAffected()).isGreaterThanOrEqualTo(2);

        assertThat(tokenRows.findByFamilyId(liveFirst.getFamilyId())).hasSize(2);
        assertThat(tokenRows.findByFamilyId(absolute.getFamilyId())).isEmpty();
        assertThat(tokenRows.findByFamilyId(expiredLong.getFamilyId())).isEmpty();
        assertThat(tokenRows.findByFamilyId(expiredRecently.getFamilyId())).hasSize(2);

        // Presenting the revoked row of the live family is still detected as reuse and kills the family.
        assertThatThrownBy(() -> tokens.rotate(liveFirst.getToken()))
                .isInstanceOf(SfException.class)
                .satisfies(e -> assertThat(((SfException) e).getProblem().getDetail()).contains("reuse"));
        assertThat(tokenRows.findByFamilyId(liveFirst.getFamilyId())).isEmpty();
    }

    private Fixtures fixtures() {
        return new Fixtures(userService, projectService, assetService);
    }

    private SystemJobRun run(String key, boolean dryRun) {
        SystemJobRunner.Started started = runner.start(key, JobTrigger.MANUAL, dryRun, null).orElseThrow();
        started.done().orTimeout(60, TimeUnit.SECONDS).join();
        return runs.findById(started.run().getId()).orElseThrow();
    }

    private long audit(Long projectId, String action, Instant at) {
        jdbc.update("INSERT INTO audit_log (project_id, action, target, created_at) VALUES (?, ?, ?, ?)",
                projectId, action, "test", utc(at));
        return jdbc.queryForObject("SELECT MAX(id) FROM audit_log WHERE action = ?", Long.class, action);
    }

    private boolean exists(long id) {
        return jdbc.queryForObject("SELECT COUNT(*) FROM audit_log WHERE id = ?", Long.class, id) > 0;
    }

    private void setExpiry(String familyId, Instant expiresAt, Instant absoluteExpiresAt) {
        jdbc.update("UPDATE refresh_token SET expires_at = ?, absolute_expires_at = ? WHERE family_id = ?",
                utc(expiresAt), utc(absoluteExpiresAt), familyId);
    }

    private static OffsetDateTime utc(Instant instant) {
        return OffsetDateTime.ofInstant(instant, ZoneOffset.UTC);
    }
}
