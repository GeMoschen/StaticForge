package com.acme.staticforge.revision.compaction;

import com.acme.staticforge.audit.AuditService;
import com.acme.staticforge.housekeeping.HousekeepingJob;
import com.acme.staticforge.housekeeping.JobCancelledException;
import com.acme.staticforge.housekeeping.JobContext;
import com.acme.staticforge.housekeeping.JobDefaults;
import com.acme.staticforge.housekeeping.JobResult;
import com.acme.staticforge.housekeeping.SettingsSpec;
import com.acme.staticforge.project.Project;
import com.acme.staticforge.project.ProjectRepository;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.time.Duration;
import java.time.Instant;
import java.util.Comparator;
import java.util.List;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

/**
 * The {@code revision-compaction} system job (M29.4.2, epic decisions 7 and 13): weekly ({@code 0 3 * * 0}), compacts
 * every non-archived project whose compaction policy is enabled, with the cutoff "now minus the project's
 * {@code olderThanDays}". Projects without a policy are skipped silently.
 *
 * <p>The run's report has one entry per project under {@code projects} ({@code projectId}, {@code projectKey},
 * {@code olderThanDays}, {@code cutoff}, the {@link CompactionResult} counts, and {@code error} when the project
 * failed); {@code GET /projects/{key}/compaction} shows the newest one. A real run audits
 * {@code REVISIONS_COMPACTED} with the counts for each project it removed versions from. A project that fails is
 * reported and the others go on ({@code PARTIAL}).
 */
@Component
public class RevisionCompactionJob implements HousekeepingJob {

    private static final Logger log = LoggerFactory.getLogger(RevisionCompactionJob.class);

    static final SettingsSpec SETTINGS = SettingsSpec.builder().integer("batchAssets", 1, 10_000).build();

    private final RevisionCompactionProperties properties;
    private final RevisionCompactor compactor;
    private final ProjectRepository projects;
    private final AuditService audit;

    public RevisionCompactionJob(
            RevisionCompactionProperties properties,
            RevisionCompactor compactor,
            ProjectRepository projects,
            AuditService audit) {
        this.properties = properties;
        this.compactor = compactor;
        this.projects = projects;
        this.audit = audit;
    }

    @Override
    public String key() {
        return CompactionPolicyService.JOB_KEY;
    }

    @Override
    public String displayName() {
        return "Revision compaction";
    }

    @Override
    public String description() {
        return "Collapses old version history of projects that opted in to the last version of each day (UTC). "
                + "Versions of releases, retained builds and pending schedules are always kept.";
    }

    @Override
    public JobDefaults defaults() {
        return JobDefaults.of(properties, settings -> settings.put("batchAssets", properties.getBatchAssets()));
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
        int batchAssets = ctx.settings().intValue("batchAssets");
        List<Project> enabled = ctx.inTransaction(() -> projects.findAll().stream()
                .filter(p -> !p.isArchived() && CompactionPolicy.fromJson(p.getCompactionPolicy()).enabled())
                .sorted(Comparator.comparing(Project::getId))
                .toList());
        ArrayNode report = ctx.report().putArray("projects");
        if (enabled.isEmpty()) {
            return JobResult.succeeded("No project has revision compaction enabled.");
        }
        int failed = 0;
        long removed = 0;
        for (Project project : enabled) {
            ctx.checkCancelled();
            CompactionPolicy policy = CompactionPolicy.fromJson(project.getCompactionPolicy());
            Instant cutoff = ctx.now().minus(Duration.ofDays(policy.olderThanDays()));
            ObjectNode entry = report.addObject()
                    .put("projectId", project.getId())
                    .put("projectKey", project.getKey())
                    .put("olderThanDays", policy.olderThanDays())
                    .put("cutoff", cutoff.toString());
            try {
                CompactionResult result = compactor.compact(project.getId(), cutoff, ctx.dryRun(), batchAssets, ctx);
                entry.setAll(result.countsJson());
                ctx.examined(result.versionsInWindow());
                ctx.affected(result.versionsRemoved());
                ctx.bytesFreed(result.bytesFreed());
                result.sample().forEach(item -> ctx.sample(project.getKey() + ": " + item));
                removed += result.versionsRemoved();
                if (!ctx.dryRun() && result.versionsRemoved() > 0) {
                    audit.record(project.getId(), null, "REVISIONS_COMPACTED", "project:" + project.getKey(),
                            result.countsJson().put("cutoff", cutoff.toString()).put("jobRunId", ctx.runId()));
                }
            } catch (JobCancelledException e) {
                throw e;
            } catch (RuntimeException e) {
                failed++;
                log.warn("Revision compaction of project {} failed", project.getKey(), e);
                entry.setAll(CompactionResult.EMPTY.countsJson());
                entry.put("error", e.getMessage() == null ? e.getClass().getSimpleName() : e.getMessage());
            }
        }
        String summary = (ctx.dryRun() ? "Would remove " : "Removed ") + removed + " versions in " + enabled.size()
                + (enabled.size() == 1 ? " project" : " projects") + ".";
        if (failed == 0) {
            return JobResult.succeeded(summary);
        }
        String failures = " " + failed + " failed; see the report.";
        return failed == enabled.size() ? JobResult.failed(summary + failures) : JobResult.partial(summary + failures);
    }
}
