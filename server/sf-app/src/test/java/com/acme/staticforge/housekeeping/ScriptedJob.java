package com.acme.staticforge.housekeeping;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.function.Function;

/**
 * A job for runner tests (M29.1.1), not a bean: a unique key per test, the schedule and behaviour the test needs, and
 * a record of the contexts it ran with. Settings: an optional {@code n} (a whole number ≥ 0).
 */
public final class ScriptedJob implements HousekeepingJob {

    private static final SettingsSpec SETTINGS = SettingsSpec.builder().integer("n", 0, 1_000).build();

    private final String key;
    private final boolean enabled;
    private final String cron;
    private final int n;
    private final boolean startup;
    private final Function<JobContext, JobResult> body;
    final List<Run> runs = new CopyOnWriteArrayList<>();

    /** What one run saw. */
    public record Run(JobTrigger trigger, boolean dryRun, java.time.Instant at, long n) {}

    private ScriptedJob(String key, boolean enabled, String cron, int n, boolean startup, Function<JobContext, JobResult> body) {
        this.key = key;
        this.enabled = enabled;
        this.cron = cron;
        this.n = n;
        this.startup = startup;
        this.body = body;
    }

    /** An enabled job on {@code cron} that succeeds. */
    public static ScriptedJob of(String key, String cron) {
        return new ScriptedJob(key, true, cron, 5, false, ctx -> JobResult.succeeded());
    }

    public ScriptedJob body(Function<JobContext, JobResult> body) {
        return new ScriptedJob(key, enabled, cron, n, startup, body);
    }

    public ScriptedJob enabled(boolean enabled) {
        return new ScriptedJob(key, enabled, cron, n, startup, body);
    }

    public ScriptedJob n(int n) {
        return new ScriptedJob(key, enabled, cron, n, startup, body);
    }

    public ScriptedJob cron(String cron) {
        return new ScriptedJob(key, enabled, cron, n, startup, body);
    }

    public ScriptedJob onStartup() {
        return new ScriptedJob(key, enabled, cron, n, true, body);
    }

    public List<Run> runs() {
        return runs;
    }

    @Override
    public String key() {
        return key;
    }

    @Override
    public String displayName() {
        return "Scripted " + key;
    }

    @Override
    public String description() {
        return "A job of a runner test.";
    }

    @Override
    public JobDefaults defaults() {
        ObjectNode settings = JsonNodeFactory.instance.objectNode().put("n", n);
        return new JobDefaults(enabled, cron, settings);
    }

    @Override
    public List<String> validateSettings(JsonNode settings) {
        return SETTINGS.validate(settings);
    }

    @Override
    public boolean supportsDryRun() {
        return true;
    }

    @Override
    public boolean runOnStartup() {
        return startup;
    }

    @Override
    public JobResult run(JobContext ctx) {
        runs.add(new Run(ctx.trigger(), ctx.dryRun(), ctx.now(), ctx.settings().longValue("n")));
        return body.apply(ctx);
    }
}
