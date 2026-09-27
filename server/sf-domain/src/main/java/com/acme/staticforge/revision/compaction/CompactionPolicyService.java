package com.acme.staticforge.revision.compaction;

import com.acme.staticforge.audit.AuditService;
import com.acme.staticforge.housekeeping.HousekeepingProblems;
import com.acme.staticforge.housekeeping.JobOutcome;
import com.acme.staticforge.housekeeping.SystemJobRun;
import com.acme.staticforge.housekeeping.SystemJobRunRepository;
import com.acme.staticforge.project.Project;
import com.acme.staticforge.project.ProjectRepository;
import com.acme.staticforge.project.ProjectService;
import com.acme.staticforge.project.ProjectWriteGuard;
import com.acme.staticforge.revision.RevisionAware;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.time.Clock;
import java.time.Instant;
import java.util.Optional;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Reads and sets a project's revision compaction policy (M29.4.1, epic decision 13).
 *
 * <p>Enabling compaction, or lowering {@code olderThanDays} while it is on, removes history for good, so it needs a
 * typed confirmation: {@code confirm} equal to the project key ({@code 422 SF-DOM-0182}). Disabling or raising the
 * threshold needs nothing. {@code olderThanDays} below {@value CompactionPolicy#MIN_OLDER_THAN_DAYS} is refused
 * ({@code 422 SF-DOM-0183}), and an archived project can't be changed ({@code 409 SF-DOM-0141}). A change is audited
 * as {@code COMPACTION_POLICY_SET} (before/after) and records no revision: the setting doesn't change any output.
 */
@Service
@RevisionAware
public class CompactionPolicyService {

    /** The key of the system job that compacts opted-in projects. */
    public static final String JOB_KEY = "revision-compaction";

    /** How many of the job's newest runs {@link #status} searches for the project's last compaction. */
    private static final int LAST_RUN_LOOKBACK = 50;

    private final ProjectService projects;
    private final ProjectRepository projectRepository;
    private final ProjectWriteGuard writeGuard;
    private final AuditService audit;
    private final SystemJobRunRepository runs;
    private final Clock clock;

    public CompactionPolicyService(
            ProjectService projects,
            ProjectRepository projectRepository,
            ProjectWriteGuard writeGuard,
            AuditService audit,
            SystemJobRunRepository runs,
            Clock clock) {
        this.projects = projects;
        this.projectRepository = projectRepository;
        this.writeGuard = writeGuard;
        this.audit = audit;
        this.runs = runs;
        this.clock = clock;
    }

    /** The project's policy, how far compaction got, and what the job last did for it. */
    @Transactional(readOnly = true)
    public CompactionStatus status(String projectKey) {
        Project project = projects.requireByKey(projectKey);
        return new CompactionStatus(
                CompactionPolicy.fromJson(project.getCompactionPolicy()),
                project.getCompactedThrough(),
                lastRun(project.getId()).orElse(null));
    }

    /**
     * Sets the policy; {@code olderThanDays} {@code null} keeps the current value. Returns the stored policy; an
     * unchanged policy records nothing.
     */
    @Transactional
    public CompactionPolicy update(
            String projectKey, boolean enabled, Integer olderThanDays, String confirm, Long actorUserId) {
        Project project = projects.requireByKey(projectKey);
        writeGuard.requireWritable(project);
        boolean configured = project.getCompactionPolicy() != null;
        CompactionPolicy before = CompactionPolicy.fromJson(project.getCompactionPolicy());
        int days = olderThanDays == null ? before.olderThanDays() : olderThanDays;
        if (days < CompactionPolicy.MIN_OLDER_THAN_DAYS) {
            throw HousekeepingProblems.compactionTooRecent(days, CompactionPolicy.MIN_OLDER_THAN_DAYS);
        }
        boolean enabling = enabled && !before.enabled();
        boolean lowering = enabled && before.enabled() && days < before.olderThanDays();
        if ((enabling || lowering) && !project.getKey().equals(confirm)) {
            throw HousekeepingProblems.compactionConfirmationRequired(project.getKey());
        }
        CompactionPolicy after = !enabled
                ? new CompactionPolicy(false, days, null, null)
                : enabling ? new CompactionPolicy(true, days, clock.instant(), actorUserId)
                : new CompactionPolicy(true, days, before.enabledAt(), before.enabledBy());
        if (after.equals(before)) {
            return before;
        }
        project.setCompactionPolicy(after.toJson());
        projectRepository.save(project);

        ObjectNode detail = JsonNodeFactory.instance.objectNode();
        detail.set("before", configured ? before.toJson() : JsonNodeFactory.instance.nullNode());
        detail.set("after", after.toJson());
        audit.record(project.getId(), actorUserId, "COMPACTION_POLICY_SET", "project:" + project.getKey(), detail);
        return after;
    }

    /** The newest finished run of the job that reports on {@code projectId}. */
    private Optional<LastRun> lastRun(long projectId) {
        for (SystemJobRun run : runs.findByJobKeyOrderByStartedAtDescIdDesc(JOB_KEY, PageRequest.of(0, LAST_RUN_LOOKBACK))) {
            if (!run.isFinished() || run.getReport() == null) {
                continue;
            }
            for (JsonNode entry : run.getReport().path("projects")) {
                if (entry.path("projectId").asLong(-1) == projectId) {
                    return Optional.of(new LastRun(
                            run.getId(),
                            run.getFinishedAt(),
                            run.isDryRun(),
                            run.getOutcome(),
                            entry.path("cutoff").isTextual() ? Instant.parse(entry.get("cutoff").asText()) : null,
                            entry.path("error").isTextual() ? entry.get("error").asText() : null,
                            CompactionResult.fromCounts(entry)));
                }
            }
        }
        return Optional.empty();
    }

    /** A project's compaction settings and progress. */
    public record CompactionStatus(CompactionPolicy policy, Long compactedThrough, LastRun lastRun) {}

    /**
     * The job's last run for one project.
     *
     * @param cutoff versions of revisions before this instant were in the window
     * @param error why the project failed in that run; {@code null} when it didn't
     */
    public record LastRun(
            long runId,
            Instant finishedAt,
            boolean dryRun,
            JobOutcome outcome,
            Instant cutoff,
            String error,
            CompactionResult result) {}
}
