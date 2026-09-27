package com.acme.staticforge.generate.retention;

import com.acme.staticforge.generate.GenerationRunRepository;
import com.acme.staticforge.generate.GenerationRunRepository.RunState;
import com.acme.staticforge.generate.GenerationTarget;
import com.acme.staticforge.generate.GenerationTargetRepository;
import com.acme.staticforge.generate.target.TargetWriterSelector;
import com.acme.staticforge.housekeeping.HousekeepingJob;
import com.acme.staticforge.housekeeping.JobContext;
import com.acme.staticforge.housekeeping.JobDefaults;
import com.acme.staticforge.housekeeping.JobResult;
import com.acme.staticforge.housekeeping.SettingsSpec;
import com.acme.staticforge.project.Project;
import com.acme.staticforge.project.ProjectRepository;
import com.acme.staticforge.scheduler.ScheduledActionExecution;
import com.acme.staticforge.scheduler.ScheduledActionExecutionRepository;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

/**
 * {@code generation-run-retention} (M29.3.1, epic decision 11): deletes generation runs that are older than
 * {@code keepDays} <em>and</em> outside the newest {@code keepPerProject} of their project, unless protected. A run is
 * <b>protected</b> when
 *
 * <ul>
 *   <li>its published build is on disk in any target of the project ({@code TargetWriter.retainedRunIds()}, which
 *       includes each target's {@code current} run) — so every rollback point stays promotable;
 *   <li>it is {@code QUEUED}/{@code RUNNING};
 *   <li>it is the base run named by the stored plan of a run with a build on disk (the build it was carried from);
 *   <li>a schedule execution younger than {@code keepDays} links it.
 * </ul>
 *
 * A run's age is its finish time (its start time while it has none). Deleted runs take their stored plan
 * ({@code generation_run_plan_entry}, {@code generation_run_plan_node}) and quality findings
 * ({@code generation_run_finding}, M30.1.2) with them in the same batch transaction.
 * {@code scheduled_action_execution.generation_run_id} has no foreign key; the job unlinks it in the same batch and
 * records the old id as {@code detail.deletedGenerationRunId}, so the schedule history shows "run deleted" instead of a
 * dead link. A dry run reports the same runs and deletes nothing. The report lists, per project, the runs deleted and
 * the oldest remaining run.
 */
@Component
public class GenerationRunRetentionJob implements HousekeepingJob {

    public static final String KEY = "generation-run-retention";

    /** The execution detail key that keeps the id of a deleted run. */
    public static final String DELETED_RUN_KEY = "deletedGenerationRunId";

    private static final int BATCH = 100;

    static final SettingsSpec SETTINGS = SettingsSpec.builder()
            .integer("keepDays", 0, 36_500)
            .integer("keepPerProject", 0, 1_000_000)
            .build();

    private final GenerationRunRetentionProperties properties;
    private final ProjectRepository projects;
    private final GenerationTargetRepository targets;
    private final GenerationRunRepository runs;
    private final ScheduledActionExecutionRepository executions;
    private final TargetWriterSelector writers;
    private final JdbcTemplate jdbc;

    public GenerationRunRetentionJob(
            GenerationRunRetentionProperties properties,
            ProjectRepository projects,
            GenerationTargetRepository targets,
            GenerationRunRepository runs,
            ScheduledActionExecutionRepository executions,
            TargetWriterSelector writers,
            JdbcTemplate jdbc) {
        this.properties = properties;
        this.projects = projects;
        this.targets = targets;
        this.runs = runs;
        this.executions = executions;
        this.writers = writers;
        this.jdbc = jdbc;
    }

    @Override
    public String key() {
        return KEY;
    }

    @Override
    public String displayName() {
        return "Generation run retention";
    }

    @Override
    public String description() {
        return "Deletes old generation runs beyond the newest per project, with their stored plans. Runs with a build on "
                + "disk, active runs, their base runs and recently scheduled runs are kept.";
    }

    @Override
    public JobDefaults defaults() {
        return JobDefaults.of(properties, settings -> settings
                .put("keepDays", properties.getKeepDays())
                .put("keepPerProject", properties.getKeepPerProject()));
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
    public JobResult run(JobContext ctx) {
        int keepPerProject = ctx.settings().intValue("keepPerProject");
        Instant cutoff = ctx.now().minus(Duration.ofDays(ctx.settings().longValue("keepDays")));
        Set<Long> scheduled = new HashSet<>(executions.findGenerationRunIdsStartedSince(cutoff));
        ObjectNode report = ctx.report().putObject("projects");
        List<Project> all = projects.findAll().stream().sorted(Comparator.comparing(Project::getKey)).toList();
        for (int i = 0; i < all.size(); i++) {
            ctx.checkCancelled();
            Project project = all.get(i);
            ctx.progress("Project " + (i + 1) + " of " + all.size() + ": " + project.getKey());
            retain(ctx, project, keepPerProject, cutoff, scheduled, report);
        }
        return JobResult.succeeded((ctx.dryRun() ? "Would delete " : "Deleted ") + ctx.affectedCount() + " run(s).");
    }

    private void retain(JobContext ctx, Project project, int keepPerProject, Instant cutoff, Set<Long> scheduled,
            ObjectNode report) {
        List<RunState> states = runs.findStatesByProjectId(project.getId());
        ctx.examined(states.size());
        if (states.size() <= keepPerProject) {
            return;
        }
        Set<Long> protectedRuns = protectedRuns(project, states, scheduled);
        List<Long> doomed = new ArrayList<>();
        RunState oldestRemaining = null;
        for (int i = 0; i < states.size(); i++) {
            RunState state = states.get(i);
            if (i >= keepPerProject && !protectedRuns.contains(state.getId()) && olderThan(state, cutoff)) {
                doomed.add(state.getId());
            } else {
                oldestRemaining = state;
            }
        }
        if (doomed.isEmpty()) {
            return;
        }
        for (int from = 0; from < doomed.size(); from += BATCH) {
            ctx.checkCancelled();
            List<Long> batch = doomed.subList(from, Math.min(from + BATCH, doomed.size()));
            if (!ctx.dryRun()) {
                ctx.inTransaction(() -> delete(batch));
            }
            ctx.affected(batch.size());
            batch.forEach(id -> ctx.sample(project.getKey() + ": run " + id));
        }
        ObjectNode entry = report.putObject(project.getKey());
        entry.put("deleted", doomed.size());
        if (oldestRemaining != null) {
            ObjectNode oldest = entry.putObject("oldestRemaining");
            oldest.put("id", oldestRemaining.getId());
            Instant at = oldestRemaining.getStartedAt();
            if (at == null) {
                oldest.putNull("startedAt");
            } else {
                oldest.put("startedAt", at.toString());
            }
        }
    }

    /** The runs of {@code project} retention must keep, whatever their age (see the class comment). */
    private Set<Long> protectedRuns(Project project, List<RunState> states, Set<Long> scheduled) {
        Set<Long> onDisk = new HashSet<>();
        for (GenerationTarget target : targets.findByProjectId(project.getId())) {
            onDisk.addAll(writers.forTarget(project.getKey(), target).retainedRunIds());
        }
        Set<Long> kept = new HashSet<>(onDisk);
        for (Long runId : onDisk) {
            runs.findById(runId)
                    .filter(run -> run.getProjectId() == project.getId())
                    .map(run -> run.getPlanSummary() == null ? null : run.getPlanSummary().get("baseRunId"))
                    .filter(base -> base != null && base.canConvertToLong() && base.asLong() >= 0)
                    .ifPresent(base -> kept.add(base.asLong()));
        }
        for (RunState state : states) {
            if (!state.status().isTerminal() || scheduled.contains(state.getId())) {
                kept.add(state.getId());
            }
        }
        return kept;
    }

    private static boolean olderThan(RunState state, Instant cutoff) {
        Instant at = state.getFinishedAt() != null ? state.getFinishedAt() : state.getStartedAt();
        return at == null || at.isBefore(cutoff);
    }

    /** Deletes one batch of runs with their plan and finding rows, unlinking schedule executions first. */
    private void delete(List<Long> runIds) {
        List<ScheduledActionExecution> linked = executions.findByGenerationRunIdIn(runIds);
        for (ScheduledActionExecution execution : linked) {
            ObjectNode detail = execution.getDetail() instanceof ObjectNode object
                    ? object.deepCopy()
                    : JsonNodeFactory.instance.objectNode();
            detail.put(DELETED_RUN_KEY, execution.getGenerationRunId());
            execution.setDetail(detail);
            execution.setGenerationRunId(null);
        }
        executions.saveAll(linked);
        executions.flush();
        String in = String.join(",", runIds.stream().map(String::valueOf).toList());
        jdbc.update("DELETE FROM generation_run_plan_entry WHERE run_id IN (" + in + ")");
        jdbc.update("DELETE FROM generation_run_plan_node WHERE run_id IN (" + in + ")");
        jdbc.update("DELETE FROM generation_run_finding WHERE run_id IN (" + in + ")");
        runs.deleteAllByIdInBatch(runIds);
    }
}
