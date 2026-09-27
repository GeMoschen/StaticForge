package com.acme.staticforge.api;

import com.acme.staticforge.api.dto.AdminAuditEntry;
import com.acme.staticforge.api.dto.AdminJobRunPage;
import com.acme.staticforge.api.dto.AdminJobRunView;
import com.acme.staticforge.api.dto.AdminJobView;
import com.acme.staticforge.api.dto.RecordPageView;
import com.acme.staticforge.api.dto.UpdateJobRequest;
import com.acme.staticforge.common.ProblemFactory;
import com.acme.staticforge.common.SfException;
import com.acme.staticforge.housekeeping.HousekeepingJob;
import com.acme.staticforge.housekeeping.SystemJob;
import com.acme.staticforge.housekeeping.SystemJobRun;
import com.acme.staticforge.housekeeping.SystemJobService;
import com.acme.staticforge.housekeeping.SystemJobService.JobState;
import com.acme.staticforge.security.SecuritySupport;
import com.acme.staticforge.user.AppUser;
import com.acme.staticforge.user.UserService;
import com.acme.staticforge.user.UserStatus;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import java.net.URI;
import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.stream.Collectors;
import org.springdoc.core.annotations.ParameterObject;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.data.web.PageableDefault;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * The system jobs (M29.1.2, epic decisions 3–5, 14): {@code /api/v1/admin/jobs/**}, instance admins only. Lists the
 * jobs with their schedule, settings and last run, pages their run history, edits schedule and settings
 * ({@code If-Match: "v{version}"}), resets them to the property defaults and starts a run or a dry run. The rules and
 * the audit live in {@link SystemJobService}; this controller parses requests and shapes responses.
 *
 * <p>Codes: {@code 404 SF-DOM-0184} unknown job (or, for edits and runs, one whose code is gone), {@code 422
 * SF-DOM-0180} invalid cron, zone or settings ({@code errors} lists every problem) or a dry run of a job without one,
 * {@code 409 SF-DOM-0181} already running, {@code 409 SF-API-0409} stale {@code If-Match}.
 */
@RestController
@RequestMapping("/api/v1/admin/jobs")
@PreAuthorize("hasAuthority('SYS_INSTANCE_ADMIN')")
public class AdminJobController {

    private static final int MAX_PAGE_SIZE = 200;

    private final SystemJobService jobs;
    private final UserService userService;
    private final SecuritySupport securitySupport;

    public AdminJobController(SystemJobService jobs, UserService userService, SecuritySupport securitySupport) {
        this.jobs = jobs;
        this.userService = userService;
        this.securitySupport = securitySupport;
    }

    /** Every job, by key, orphaned ones included. */
    @GetMapping
    public List<AdminJobView> list() {
        return jobs.list().stream().map(this::view).toList();
    }

    @GetMapping("/{key}")
    public ResponseEntity<AdminJobView> detail(@PathVariable String key) {
        return respond(jobs.get(key));
    }

    /**
     * The job's runs, newest first, each with its report sample. The sort of the page request is ignored; {@code size}
     * is at most {@value #MAX_PAGE_SIZE}.
     */
    @GetMapping("/{key}/runs")
    public AdminJobRunPage runs(
            @PathVariable String key, @ParameterObject @PageableDefault(size = 20) Pageable pageable) {
        if (pageable.getPageSize() > MAX_PAGE_SIZE) {
            throw new SfException(ProblemFactory.badRequest("size must be at most " + MAX_PAGE_SIZE + ".", "size"));
        }
        Page<SystemJobRun> result =
                jobs.runs(key, PageRequest.of(pageable.getPageNumber(), pageable.getPageSize()));
        Map<Long, AppUser> starters = starters(result.getContent());
        return new AdminJobRunPage(
                result.getContent().stream().map(run -> runView(run, starters, false)).toList(),
                new RecordPageView.PageMeta(
                        result.getSize(), result.getNumber(), result.getTotalElements(), result.getTotalPages()));
    }

    /** One run with its full report. */
    @GetMapping("/{key}/runs/{runId}")
    public AdminJobRunView run(@PathVariable String key, @PathVariable long runId) {
        SystemJobRun run = jobs.run(key, runId);
        return runView(run, starters(List.of(run)), true);
    }

    /**
     * Changes {@code enabled}, {@code cron}, {@code zone} and settings (merged) of the job read at the
     * {@code If-Match} version, recomputes its next run and audits {@code JOB_SETTINGS_SET}.
     */
    @PatchMapping("/{key}")
    public ResponseEntity<AdminJobView> update(
            @PathVariable String key,
            @RequestHeader(value = HttpHeaders.IF_MATCH, required = false) String ifMatch,
            @RequestBody UpdateJobRequest body) {
        long expected = ScheduleController.expectedVersion(ifMatch);
        return respond(jobs.update(
                key,
                expected,
                new SystemJobService.Update(body.enabled(), body.cron(), body.zone(), body.settings()),
                securitySupport.currentUserId()));
    }

    /** Back to the property defaults and {@code sf.housekeeping.zone}; audited {@code JOB_SETTINGS_SET}. */
    @PostMapping("/{key}/reset")
    public ResponseEntity<AdminJobView> reset(@PathVariable String key) {
        return respond(jobs.reset(key, securitySupport.currentUserId()));
    }

    /**
     * Starts a run ({@code dryRun=true}: report only) and answers {@code 202} with the run and its {@code Location};
     * poll the run until {@code finishedAt} is set. Audited {@code JOB_RUN}.
     */
    @PostMapping("/{key}/run")
    public ResponseEntity<AdminJobRunView> runNow(
            @PathVariable String key, @RequestParam(defaultValue = "false") boolean dryRun) {
        SystemJobRun run = jobs.runNow(key, dryRun, securitySupport.currentUserId());
        return ResponseEntity.status(HttpStatus.ACCEPTED)
                .location(URI.create("/api/v1/admin/jobs/" + key + "/runs/" + run.getId()))
                .body(runView(run, starters(List.of(run)), false));
    }

    // ------------------------------------------------------------------
    // Mapping
    // ------------------------------------------------------------------

    private ResponseEntity<AdminJobView> respond(JobState state) {
        return ResponseEntity.ok()
                .header(HttpHeaders.ETAG, "\"v" + state.row().getVersion() + "\"")
                .body(view(state));
    }

    private AdminJobView view(JobState state) {
        SystemJob row = state.row();
        HousekeepingJob job = state.job();
        SystemJobService.Defaults defaults = jobs.defaults(state.key());
        SystemJobRun current = state.current();
        SystemJobRun last = state.lastRun();
        return new AdminJobView(
                row.getKey(),
                job == null ? null : job.displayName(),
                job == null ? null : job.description(),
                row.isEnabled(),
                row.getCron(),
                row.getZoneId(),
                state.settings(),
                defaults == null
                        ? null
                        : new AdminJobView.JobDefaults(
                                defaults.enabled(), defaults.cron(), defaults.zone(), defaults.settings()),
                row.getNextRunAt(),
                state.running(),
                current == null ? null : current.getStartedAt(),
                current == null ? null : current.getId(),
                current == null ? null : current.getMessage(),
                job != null && job.supportsDryRun(),
                state.orphaned(),
                row.getVersion(),
                row.getUpdatedAt(),
                last == null
                        ? null
                        : new AdminJobView.JobRunSummary(
                                last.getId(),
                                last.getOutcome() == null ? null : last.getOutcome().name(),
                                last.getTrigger().name(),
                                last.isDryRun(),
                                last.getStartedAt(),
                                last.getFinishedAt(),
                                millis(last.getDuration()),
                                last.getItemsExamined(),
                                last.getItemsAffected(),
                                last.getBytesFreed(),
                                last.getMessage()));
    }

    private static AdminJobRunView runView(SystemJobRun run, Map<Long, AppUser> starters, boolean withReport) {
        JsonNode report = run.getReport();
        JsonNode sample = report != null && report.path("sample").isArray()
                ? report.get("sample")
                : JsonNodeFactory.instance.arrayNode();
        long sampleTotal = report == null ? 0 : report.path("sampleTotal").asLong(sample.size());
        AdminAuditEntry.Actor startedBy = null;
        if (run.getStartedBy() != null) {
            AppUser user = starters.get(run.getStartedBy());
            startedBy = new AdminAuditEntry.Actor(run.getStartedBy(), user == null ? null : actorName(user));
        }
        return new AdminJobRunView(
                run.getId(),
                run.getJobKey(),
                run.getTrigger().name(),
                run.isDryRun(),
                run.getStartedAt(),
                run.getFinishedAt(),
                millis(run.getDuration()),
                run.getOutcome() == null ? null : run.getOutcome().name(),
                run.getItemsExamined(),
                run.getItemsAffected(),
                run.getBytesFreed(),
                run.getMessage(),
                startedBy,
                sample,
                sampleTotal,
                withReport ? report : null);
    }

    private Map<Long, AppUser> starters(List<SystemJobRun> runs) {
        return userService.findAllById(runs.stream()
                .map(SystemJobRun::getStartedBy)
                .filter(Objects::nonNull)
                .collect(Collectors.toSet()));
    }

    /** A deleted account shows as its anonymized display name, like the audit trail. */
    private static String actorName(AppUser user) {
        return user.getStatus() == UserStatus.DELETED ? user.getDisplayName() : user.getUsername();
    }

    private static Long millis(Duration duration) {
        return duration == null ? null : duration.toMillis();
    }
}
