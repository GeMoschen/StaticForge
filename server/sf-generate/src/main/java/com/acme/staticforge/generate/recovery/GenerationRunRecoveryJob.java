package com.acme.staticforge.generate.recovery;

import com.acme.staticforge.generate.GenerationRun;
import com.acme.staticforge.generate.GenerationRunControl;
import com.acme.staticforge.generate.GenerationRunRepository;
import com.acme.staticforge.generate.GenerationService;
import com.acme.staticforge.housekeeping.HousekeepingJob;
import com.acme.staticforge.housekeeping.JobContext;
import com.acme.staticforge.housekeeping.JobDefaults;
import com.acme.staticforge.housekeeping.JobResult;
import com.acme.staticforge.housekeeping.SettingsSpec;
import com.acme.staticforge.node.NodeIdentity;
import com.acme.staticforge.project.Project;
import com.acme.staticforge.project.ProjectRepository;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.time.Duration;
import java.time.Instant;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import org.springframework.stereotype.Component;

/**
 * {@code generation-run-recovery} (M29.2.1, epic decision 9): fails the {@code QUEUED}/{@code RUNNING} runs that
 * nothing executes any more, so a crash or restart never blocks a project's builds (and its schedules) for good.
 *
 * <p>A run is <b>interrupted</b> when it is not held by this node's executor and
 *
 * <ul>
 *   <li>it has no {@code executor_node} (queued before M29), or
 *   <li>its node is this node (a restart: this process holds nothing it didn't queue itself), or
 *   <li>its node is an earlier process of this host that is gone ({@link NodeIdentity#isDeadLocalProcess}), or
 *   <li>its heartbeat — for a queued run its queue time — is older than {@code staleAfter} (any node).
 * </ul>
 *
 * It runs at startup and on its cron. An interrupted run becomes {@code FAILED} with {@code SF-GEN-0504} "Run
 * interrupted (node restart or lost heartbeat)"; the decision is re-checked on the locked row, so a run that sent a
 * heartbeat meanwhile is left alone ({@link GenerationService#interrupt}). Its staged output is left to
 * {@code build-output-cleanup}. The report lists the recovered run ids per project ({@code recovered}).
 */
@Component
public class GenerationRunRecoveryJob implements HousekeepingJob {

    public static final String KEY = "generation-run-recovery";

    static final SettingsSpec SETTINGS = SettingsSpec.builder()
            .duration("staleAfter", Duration.ofMinutes(1), null)
            .build();

    private final GenerationRunRecoveryProperties properties;
    private final GenerationRunRepository runs;
    private final GenerationService generations;
    private final GenerationRunControl control;
    private final NodeIdentity node;
    private final ProjectRepository projects;

    public GenerationRunRecoveryJob(
            GenerationRunRecoveryProperties properties,
            GenerationRunRepository runs,
            GenerationService generations,
            GenerationRunControl control,
            NodeIdentity node,
            ProjectRepository projects) {
        this.properties = properties;
        this.runs = runs;
        this.generations = generations;
        this.control = control;
        this.node = node;
        this.projects = projects;
    }

    @Override
    public String key() {
        return KEY;
    }

    @Override
    public String displayName() {
        return "Generation run recovery";
    }

    @Override
    public String description() {
        return "Fails queued or running builds that no node executes any more (after a restart or a lost heartbeat), "
                + "so the project can build again.";
    }

    @Override
    public JobDefaults defaults() {
        return JobDefaults.of(properties, settings -> settings.put("staleAfter", properties.getStaleAfter().toString()));
    }

    @Override
    public List<String> validateSettings(JsonNode settings) {
        return SETTINGS.validate(settings);
    }

    @Override
    public boolean runOnStartup() {
        return true;
    }

    @Override
    public JobResult run(JobContext ctx) {
        Instant staleBefore = ctx.now().minus(ctx.settings().duration("staleAfter"));
        List<GenerationRun> active = runs.findAllActive();
        ctx.examined(active.size());
        ObjectNode recovered = ctx.report().putObject("recovered");
        Map<Long, String> projectKeys = new HashMap<>();
        for (GenerationRun candidate : active) {
            ctx.checkCancelled();
            if (control.isHeld(candidate.getId()) || !interrupted(candidate, staleBefore)) {
                continue;
            }
            generations.interrupt(candidate.getId(), fresh -> interrupted(fresh, staleBefore)).ifPresent(run -> {
                String projectKey = projectKeys.computeIfAbsent(run.getProjectId(),
                        id -> projects.findById(id).map(Project::getKey).orElse("#" + id));
                recovered.withArray(projectKey).add(run.getId());
                ctx.affected(1);
                ctx.sample(projectKey + ": run " + run.getId());
            });
        }
        return JobResult.succeeded(ctx.affectedCount() == 0
                ? "No interrupted runs (" + active.size() + " active)."
                : "Recovered " + ctx.affectedCount() + " interrupted run(s) of " + active.size() + " active.");
    }

    /** Whether an active run that this node doesn't hold is dead (see the class comment). */
    private boolean interrupted(GenerationRun run, Instant staleBefore) {
        String executor = run.getExecutorNode();
        if (executor == null || Objects.equals(executor, node.id()) || node.isDeadLocalProcess(executor)) {
            return true;
        }
        Instant lastSign = run.getHeartbeatAt() != null ? run.getHeartbeatAt() : run.getStartedAt();
        return lastSign == null || lastSign.isBefore(staleBefore);
    }
}
