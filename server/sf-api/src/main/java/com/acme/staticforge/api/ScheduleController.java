package com.acme.staticforge.api;

import com.acme.staticforge.api.dto.PreviewTimesRequest;
import com.acme.staticforge.api.dto.PreviewTimesView;
import com.acme.staticforge.api.dto.ScheduleExecutionPageView;
import com.acme.staticforge.api.dto.ScheduleExecutionView;
import com.acme.staticforge.api.dto.ScheduleItemView;
import com.acme.staticforge.api.dto.SchedulePageView;
import com.acme.staticforge.api.dto.ScheduleRequest;
import com.acme.staticforge.api.dto.ScheduleView;
import com.acme.staticforge.common.ProblemFactory;
import com.acme.staticforge.common.SfException;
import com.acme.staticforge.project.ProjectService;
import com.acme.staticforge.scheduler.ActionStatus;
import com.acme.staticforge.scheduler.MissedPolicy;
import com.acme.staticforge.scheduler.PinPolicy;
import com.acme.staticforge.scheduler.ScheduleService;
import com.acme.staticforge.scheduler.ScheduleTiming;
import com.acme.staticforge.scheduler.ScheduledAction;
import com.acme.staticforge.scheduler.ScheduledActionExecution;
import com.acme.staticforge.security.SecuritySupport;
import java.time.Duration;
import java.time.Instant;
import java.time.format.DateTimeParseException;
import java.util.EnumSet;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.UUID;
import java.util.function.Function;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.http.HttpHeaders;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * Schedules of a project (M27.4.4): scheduled release and unpublish, one-off and recurring generation. Members read
 * ({@code VIEWER}); every change needs what the action's handler requires of the caller (M27: {@code DEVELOPER}),
 * checked in {@link ScheduleService} with the same rule the engine applies to the owner at execution — so this
 * controller has no per-type logic. Times are ISO instants; a recurring action's cron is evaluated in its
 * {@code zoneId}.
 */
@RestController
@RequestMapping("/api/v1/projects/{projectKey}/schedules")
public class ScheduleController {

    static final int MAX_SIZE = 200;

    private final ProjectService projectService;
    private final ScheduleService scheduleService;
    private final SecuritySupport securitySupport;

    public ScheduleController(ProjectService projectService, ScheduleService scheduleService, SecuritySupport securitySupport) {
        this.projectService = projectService;
        this.scheduleService = scheduleService;
        this.securitySupport = securitySupport;
    }

    /**
     * One page of schedules, the next due first. Filters combine: {@code type} and {@code status} may repeat;
     * {@code owner} is a user id; {@code assetUuid} keeps the actions touching that asset; {@code from}/{@code to}
     * bound {@code nextRunAt} ({@code [from, to)}).
     */
    @GetMapping
    @PreAuthorize("@projectAuth.has(#projectKey, " + ProjectRoleExpr.VIEWER + ")")
    public SchedulePageView list(
            @PathVariable String projectKey,
            @RequestParam(value = "type", required = false) List<String> types,
            @RequestParam(value = "status", required = false) List<String> statuses,
            @RequestParam(required = false) Long owner,
            @RequestParam(required = false) UUID assetUuid,
            @RequestParam(required = false) Instant from,
            @RequestParam(required = false) Instant to,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "50") int size) {
        if (page < 0 || size < 1 || size > MAX_SIZE) {
            throw new SfException(ProblemFactory.badRequest("page must be ≥ 0 and size between 1 and " + MAX_SIZE + "."));
        }
        Set<String> typeFilter = new LinkedHashSet<>();
        if (types != null) {
            types.stream().filter(t -> t != null && !t.isBlank()).map(t -> t.trim().toUpperCase(Locale.ROOT)).forEach(typeFilter::add);
        }
        Set<ActionStatus> statusFilter = EnumSet.noneOf(ActionStatus.class);
        if (statuses != null) {
            statuses.stream().filter(s -> s != null && !s.isBlank())
                    .forEach(s -> statusFilter.add(parse(s, ActionStatus::valueOf, "status")));
        }
        Page<ScheduleService.Summary> result = scheduleService.list(
                projectId(projectKey),
                new ScheduleService.Filter(typeFilter, statusFilter, owner, assetUuid, from, to),
                page,
                size);
        return new SchedulePageView(
                result.getContent().stream().map(s -> view(s, false)).toList(),
                page,
                size,
                result.getTotalElements(),
                result.getTotalPages());
    }

    /** One schedule with its items (a release's drift per item) and params. */
    @GetMapping("/{id}")
    @PreAuthorize("@projectAuth.has(#projectKey, " + ProjectRoleExpr.VIEWER + ")")
    public ResponseEntity<ScheduleView> detail(@PathVariable String projectKey, @PathVariable long id) {
        return respond(scheduleService.detail(projectId(projectKey), id));
    }

    /**
     * Creates a schedule. {@code 422}: {@code SF-DOM-0160} unknown type, {@code 0161} invalid params, {@code 0164}
     * {@code runAt} in the past, {@code 0165} invalid cron or zone, {@code 0166} a timing form that doesn't fit the
     * type, and the release codes ({@code SF-DOM-0150} a pinned version is incomplete, {@code 0151}, {@code 0153}).
     */
    @PostMapping
    @PreAuthorize("@projectAuth.has(#projectKey, " + ProjectRoleExpr.VIEWER + ")")
    public ResponseEntity<ScheduleView> create(@PathVariable String projectKey, @RequestBody ScheduleRequest body) {
        long projectId = projectId(projectKey);
        if (body.type() == null || body.type().isBlank()) {
            throw new SfException(ProblemFactory.badRequest("type is required.", "type"));
        }
        ScheduledAction action = scheduleService.create(projectId, command(body, body.type()), userId());
        return respond(scheduleService.detail(projectId, action.getId()));
    }

    /**
     * Replaces time, policies and params of a pending schedule; {@code If-Match: "v{version}"} is required
     * ({@code 409 SF-API-0409} when stale). Omitted {@code params} keep the stored ones.
     */
    @PutMapping("/{id}")
    @PreAuthorize("@projectAuth.has(#projectKey, " + ProjectRoleExpr.VIEWER + ")")
    public ResponseEntity<ScheduleView> update(
            @PathVariable String projectKey,
            @PathVariable long id,
            @RequestHeader(value = HttpHeaders.IF_MATCH, required = false) String ifMatch,
            @RequestBody ScheduleRequest body) {
        long projectId = projectId(projectKey);
        scheduleService.update(projectId, id, expectedVersion(ifMatch), command(body, body.type()), userId());
        return respond(scheduleService.detail(projectId, id));
    }

    /** Cancels a pending or paused schedule ({@code 409 SF-DOM-0167} while it executes). */
    @PostMapping("/{id}/cancel")
    @PreAuthorize("@projectAuth.has(#projectKey, " + ProjectRoleExpr.VIEWER + ")")
    public ResponseEntity<ScheduleView> cancel(@PathVariable String projectKey, @PathVariable long id) {
        long projectId = projectId(projectKey);
        scheduleService.cancel(projectId, id, userId());
        return respond(scheduleService.detail(projectId, id));
    }

    /**
     * Makes the caller the owner. A paused recurring schedule resumes at its next slot; a failed one-off becomes due
     * at its original time — at once when that has passed, with the missed policy applied to the original time.
     */
    @PostMapping("/{id}/take-over")
    @PreAuthorize("@projectAuth.has(#projectKey, " + ProjectRoleExpr.VIEWER + ")")
    public ResponseEntity<ScheduleView> takeOver(@PathVariable String projectKey, @PathVariable long id) {
        long projectId = projectId(projectKey);
        scheduleService.takeOver(projectId, id, userId());
        return respond(scheduleService.detail(projectId, id));
    }

    /** Makes a pending schedule due now (executed on the next poll); a recurring one keeps its cron. */
    @PostMapping("/{id}/run-now")
    @PreAuthorize("@projectAuth.has(#projectKey, " + ProjectRoleExpr.VIEWER + ")")
    public ResponseEntity<ScheduleView> runNow(@PathVariable String projectKey, @PathVariable long id) {
        long projectId = projectId(projectKey);
        scheduleService.runNow(projectId, id, userId());
        return respond(scheduleService.detail(projectId, id));
    }

    /** Pins a pending scheduled release to the current drafts ({@code 422 SF-DOM-0168} unless a pinned release). */
    @PostMapping("/{id}/repin")
    @PreAuthorize("@projectAuth.has(#projectKey, " + ProjectRoleExpr.VIEWER + ")")
    public ResponseEntity<ScheduleView> repin(@PathVariable String projectKey, @PathVariable long id) {
        long projectId = projectId(projectKey);
        scheduleService.repin(projectId, id, userId());
        return respond(scheduleService.detail(projectId, id));
    }

    /** The executions of a schedule, newest first. */
    @GetMapping("/{id}/executions")
    @PreAuthorize("@projectAuth.has(#projectKey, " + ProjectRoleExpr.VIEWER + ")")
    public ScheduleExecutionPageView executions(
            @PathVariable String projectKey,
            @PathVariable long id,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "50") int size) {
        if (page < 0 || size < 1 || size > MAX_SIZE) {
            throw new SfException(ProblemFactory.badRequest("page must be ≥ 0 and size between 1 and " + MAX_SIZE + "."));
        }
        Page<ScheduledActionExecution> result =
                scheduleService.executions(projectId(projectKey), id, PageRequest.of(page, size));
        return new ScheduleExecutionPageView(
                result.getContent().stream().map(ScheduleController::view).toList(),
                page,
                size,
                result.getTotalElements(),
                result.getTotalPages());
    }

    /** The next run times of a cron in a zone, validated like a create (the schedule dialog's preview). */
    @PostMapping("/preview-times")
    @PreAuthorize("@projectAuth.has(#projectKey, " + ProjectRoleExpr.VIEWER + ")")
    @AllowedOnArchivedProject("read-only: computes the next run times of a cron, stores nothing")
    public PreviewTimesView previewTimes(@PathVariable String projectKey, @RequestBody PreviewTimesRequest body) {
        projectId(projectKey);
        int count = body.count() == null ? 5 : body.count();
        List<Instant> times = scheduleService.previewTimes(body.cron(), body.zoneId(), count);
        return new PreviewTimesView(
                ScheduleTiming.normalizeCron(body.cron()), ScheduleTiming.zone(body.zoneId()).getId(), times);
    }

    // ------------------------------------------------------------------
    // Mapping
    // ------------------------------------------------------------------

    private static ScheduleService.Command command(ScheduleRequest body, String type) {
        return new ScheduleService.Command(
                type == null || type.isBlank() ? null : type.trim().toUpperCase(Locale.ROOT),
                body.runAt(),
                body.cron(),
                body.zoneId(),
                body.pinPolicy() == null || body.pinPolicy().isBlank() ? null : parse(body.pinPolicy(), PinPolicy::valueOf, "pinPolicy"),
                body.missedPolicy() == null || body.missedPolicy().isBlank()
                        ? null
                        : parse(body.missedPolicy(), MissedPolicy::valueOf, "missedPolicy"),
                duration(body.maxLateness()),
                body.thenGenerate(),
                body.params());
    }

    private static <E extends Enum<E>> E parse(String value, Function<String, E> valueOf, String field) {
        try {
            return valueOf.apply(value.trim().toUpperCase(Locale.ROOT));
        } catch (IllegalArgumentException e) {
            throw new SfException(ProblemFactory.badRequest("Unknown " + field + ": " + value, field));
        }
    }

    private static Duration duration(String value) {
        if (value == null || value.isBlank()) {
            return null;
        }
        try {
            return Duration.parse(value.trim());
        } catch (DateTimeParseException e) {
            throw new SfException(ProblemFactory.badRequest(
                    "maxLateness must be an ISO-8601 duration such as PT15M: " + value, "maxLateness"));
        }
    }

    /** {@code If-Match: "v12"} (quotes optional) → 12; {@code 412} when missing. */
    static long expectedVersion(String ifMatch) {
        if (ifMatch == null || ifMatch.isBlank()) {
            throw new SfException(ProblemFactory.other(
                    412, "SF-API-0412", "Precondition Failed", "If-Match header is required on mutating requests."));
        }
        String value = ifMatch.trim();
        if (value.startsWith("W/")) {
            value = value.substring(2);
        }
        if (value.startsWith("\"") && value.endsWith("\"") && value.length() >= 2) {
            value = value.substring(1, value.length() - 1);
        }
        if (value.startsWith("v")) {
            value = value.substring(1);
        }
        try {
            return Long.parseLong(value);
        } catch (NumberFormatException e) {
            throw new SfException(ProblemFactory.badRequest("Invalid If-Match header: " + ifMatch));
        }
    }

    private static ResponseEntity<ScheduleView> respond(ScheduleService.Summary summary) {
        return ResponseEntity.ok()
                .header(HttpHeaders.ETAG, "\"v" + summary.action().getVersion() + "\"")
                .body(view(summary, true));
    }

    static ScheduleView view(ScheduleService.Summary summary, boolean withItems) {
        ScheduledAction a = summary.action();
        var description = summary.description();
        int itemCount = a.getParams() != null && a.getParams().path("items").isArray() ? a.getParams().path("items").size() : 0;
        List<ScheduleItemView> items = withItems
                ? description.items().stream()
                        .map(i -> new ScheduleItemView(i.assetUuid(), i.assetType(), i.uid(), i.displayName(), i.locale(),
                                i.pinnedVersionId(), i.draftChangedSinceScheduled(), i.status()))
                        .toList()
                : null;
        return new ScheduleView(
                a.getId(),
                a.getUuid(),
                a.getType(),
                a.getStatus().name(),
                a.getRunAt(),
                a.getCron(),
                a.getZoneId(),
                a.getNextRunAt(),
                a.getPinPolicy() == null ? null : a.getPinPolicy().name(),
                a.getMissedPolicy().name(),
                a.getMaxLateness() == null ? null : a.getMaxLateness().toString(),
                a.getThenGenerate(),
                a.getParams(),
                a.getOwnerUserId(),
                a.getCreatedBy(),
                a.getCreatedAt(),
                a.getUpdatedAt(),
                a.getVersion(),
                itemCount,
                description.driftCount(),
                items,
                summary.lastExecution() == null ? null : view(summary.lastExecution()));
    }

    static ScheduleExecutionView view(ScheduledActionExecution e) {
        return new ScheduleExecutionView(
                e.getId(),
                e.getScheduledFor(),
                e.getStartedAt(),
                e.getFinishedAt(),
                e.getOutcome() == null ? null : e.getOutcome().name(),
                e.getLateByMs(),
                e.getMessage(),
                e.getDetail(),
                e.getRevisionId(),
                e.getGenerationRunId(),
                e.getExecutedAsUserId());
    }

    private long projectId(String key) {
        return projectService.requireByKey(key).getId();
    }

    private long userId() {
        return securitySupport.currentUserId();
    }
}
