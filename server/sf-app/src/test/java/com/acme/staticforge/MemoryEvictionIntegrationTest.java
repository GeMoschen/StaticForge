package com.acme.staticforge;

import static org.assertj.core.api.Assertions.assertThat;

import com.acme.staticforge.BuildInsightFixtures.Fixture;
import com.acme.staticforge.asset.AssetRepository;
import com.acme.staticforge.asset.AssetService;
import com.acme.staticforge.asset.media.MediaService;
import com.acme.staticforge.asset.navigation.PageReferenceService;
import com.acme.staticforge.asset.template.TemplateService;
import com.acme.staticforge.asset.template.TemplateView;
import com.acme.staticforge.generate.GenerationMode;
import com.acme.staticforge.generate.GenerationProperties;
import com.acme.staticforge.generate.GenerationRequest;
import com.acme.staticforge.generate.GenerationService;
import com.acme.staticforge.generate.GenerationTarget;
import com.acme.staticforge.generate.GenerationTargetRepository;
import com.acme.staticforge.generate.TargetType;
import com.acme.staticforge.housekeeping.JobTrigger;
import com.acme.staticforge.housekeeping.SystemJobFixtures;
import com.acme.staticforge.housekeeping.SystemJobRun;
import com.acme.staticforge.housekeeping.SystemJobRunner;
import com.acme.staticforge.housekeeping.memory.MemoryEvictionJob;
import com.acme.staticforge.project.ProjectService;
import com.acme.staticforge.security.LoginAttemptService;
import com.acme.staticforge.user.UserService;
import com.fasterxml.jackson.databind.JsonNode;
import java.nio.file.Path;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;

/**
 * {@code memory-eviction} (M29.2.4): an idempotency key older than {@code sf.generate.idempotency-ttl} is forgotten and
 * a re-submission with it starts a new run (a younger one still returns the first run); idle login-limiter keys go.
 * The job runs on a runner whose clock is moved past the TTL.
 */
@SpringBootTest
@ActiveProfiles("test")
class MemoryEvictionIntegrationTest {

    @Autowired UserService users;
    @Autowired ProjectService projects;
    @Autowired AssetService assetService;
    @Autowired AssetRepository assetRepository;
    @Autowired TemplateService templateService;
    @Autowired MediaService mediaService;
    @Autowired PageReferenceService pageReferenceService;
    @Autowired GenerationTargetRepository targets;
    @Autowired GenerationService generationService;
    @Autowired GenerationProperties generationProperties;
    @Autowired ReleaseFixtures releases;
    @Autowired SchedulerFixtures schedules;
    @Autowired SystemJobFixtures jobFixtures;
    @Autowired MemoryEvictionJob job;
    @Autowired LoginAttemptService loginAttempts;

    private BuildInsightFixtures fixtures;
    private Fixture fx;

    @BeforeEach
    void setUp() {
        fixtures = new BuildInsightFixtures(users, projects, assetService, assetRepository, templateService, mediaService,
                pageReferenceService, targets, generationService, releases, Path.of(generationProperties.getOutputRoot()));
    }

    @AfterEach
    void retire() {
        if (fx != null) {
            schedules.retire(fx.projectId());
        }
    }

    @Test
    void anExpiredIdempotencyKeyStartsANewRunAndIdleLimiterKeysGo() throws Exception {
        fx = fixtures.project("mem-evict");
        TemplateView plain = fixtures.pageTemplate(fx, "Plain", "", "<p>plain</p>");
        fixtures.page(fx, "Home", plain.uuid());
        GenerationTarget target = fixtures.target(fx, "fs", TargetType.FILESYSTEM);
        String key = "evict-" + System.nanoTime();
        long first = fixtures.succeeded(fixtures.generate(fx, request(target, key))).getId();
        assertThat(generationService.start(fx.project().getKey(), request(target, key), fx.user().getId()).getId())
                .isEqualTo(first);
        loginAttempts.recordIpFailure("203.0.113.9:mem-evict");

        // An hour later the key is still remembered (TTL 24 h); the limiter entry has left its 5-minute window.
        SystemJobRun hourLater = evictAt(Instant.now().plus(Duration.ofHours(1)));
        assertThat(generationService.start(fx.project().getKey(), request(target, key), fx.user().getId()).getId())
                .isEqualTo(first);
        JsonNode limiter = hourLater.getReport().path("loginLimiter");
        assertThat(limiter.path("before").asInt()).isGreaterThanOrEqualTo(1);
        assertThat(limiter.path("after").asInt()).isZero();
        assertThat(loginAttempts.size()).isZero();

        // Past the TTL the key is forgotten: the same key now starts a new run.
        SystemJobRun dayLater = evictAt(Instant.now().plus(generationProperties.getIdempotencyTtl()).plusSeconds(60));
        JsonNode keys = dayLater.getReport().path("idempotencyKeys");
        assertThat(keys.path("evicted").asInt()).isGreaterThanOrEqualTo(1);
        assertThat(keys.path("after").asInt()).isEqualTo(generationService.idempotencyKeyCount());
        long second = fixtures.succeeded(fixtures.generate(fx, request(target, key))).getId();
        assertThat(second).isNotEqualTo(first);
    }

    private static GenerationRequest request(GenerationTarget target, String key) {
        return new GenerationRequest(GenerationMode.FULL, null, List.of("html"), target.getId(), null, null, null, key);
    }

    /** One run of the job on a runner whose clock reads {@code at}. */
    private SystemJobRun evictAt(Instant at) {
        try (SystemJobRunner runner = jobFixtures.runner("mem-node", new MutableClock(at), job)) {
            SystemJobRunner.Started started = runner.start(MemoryEvictionJob.KEY, JobTrigger.MANUAL, false, null).orElseThrow();
            started.done().orTimeout(30, TimeUnit.SECONDS).join();
            return jobFixtures.run(started.run().getId());
        }
    }
}
