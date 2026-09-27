package com.acme.staticforge.housekeeping.memory;

import com.acme.staticforge.generate.GenerationService;
import com.acme.staticforge.housekeeping.HousekeepingJob;
import com.acme.staticforge.housekeeping.JobContext;
import com.acme.staticforge.housekeeping.JobDefaults;
import com.acme.staticforge.housekeeping.JobProperties;
import com.acme.staticforge.housekeeping.JobResult;
import com.acme.staticforge.housekeeping.SettingsSpec;
import com.acme.staticforge.security.LoginAttemptService;
import com.fasterxml.jackson.databind.JsonNode;
import java.time.Instant;
import java.util.List;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;

/**
 * {@code memory-eviction} (M29.2.4, epic finding 8): keeps this node's in-memory maps bounded.
 *
 * <ul>
 *   <li>Login limiter: drops (IP, username) buckets whose newest attempt left the window and that aren't blocked
 *       ({@link LoginAttemptService#evictIdle}); a key is otherwise only removed by a successful login.
 *   <li>Generation idempotency keys: forgets keys older than {@code sf.generate.idempotency-ttl} (default 24 h,
 *       {@link GenerationService#evictIdempotencyKeys}); a re-submission with a forgotten key starts a new run.
 * </ul>
 *
 * Both maps are per node and the job runs where it holds the lease, so on several nodes each node's maps are evicted
 * only when it runs the job (single node today, §26.2). No settings; the report has each map's size before and after.
 */
@Component
public class MemoryEvictionJob implements HousekeepingJob {

    public static final String KEY = "memory-eviction";

    static final SettingsSpec SETTINGS = SettingsSpec.builder().build();

    private final Properties properties;
    private final LoginAttemptService loginAttempts;
    private final GenerationService generations;

    public MemoryEvictionJob(Properties properties, LoginAttemptService loginAttempts, GenerationService generations) {
        this.properties = properties;
        this.loginAttempts = loginAttempts;
        this.generations = generations;
    }

    /** {@code sf.housekeeping.memory-eviction.*}: schedule only. */
    @Component
    @ConfigurationProperties(prefix = "sf.housekeeping.memory-eviction")
    public static class Properties extends JobProperties {

        public Properties() {
            super(true, "*/10 * * * *");
        }
    }

    @Override
    public String key() {
        return KEY;
    }

    @Override
    public String displayName() {
        return "Memory eviction";
    }

    @Override
    public String description() {
        return "Forgets idle login rate-limit entries and expired generation idempotency keys, so in-memory maps stay "
                + "bounded.";
    }

    @Override
    public JobDefaults defaults() {
        return JobDefaults.of(properties, settings -> {});
    }

    @Override
    public List<String> validateSettings(JsonNode settings) {
        return SETTINGS.validate(settings);
    }

    @Override
    public JobResult run(JobContext ctx) {
        Instant now = ctx.now();
        int limiterBefore = loginAttempts.size();
        int limiterEvicted = loginAttempts.evictIdle(now);
        int keysBefore = generations.idempotencyKeyCount();
        int keysEvicted = generations.evictIdempotencyKeys(now.minus(generations.idempotencyTtl()));

        ctx.examined(limiterBefore + keysBefore);
        ctx.affected(limiterEvicted + keysEvicted);
        ctx.report().putObject("loginLimiter")
                .put("before", limiterBefore)
                .put("after", loginAttempts.size())
                .put("evicted", limiterEvicted);
        ctx.report().putObject("idempotencyKeys")
                .put("before", keysBefore)
                .put("after", generations.idempotencyKeyCount())
                .put("evicted", keysEvicted);
        return JobResult.succeeded("Evicted " + limiterEvicted + " login limiter entr" + (limiterEvicted == 1 ? "y" : "ies")
                + " and " + keysEvicted + " idempotency key(s).");
    }
}
