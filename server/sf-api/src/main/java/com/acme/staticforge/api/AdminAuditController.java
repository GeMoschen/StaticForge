package com.acme.staticforge.api;

import com.acme.staticforge.api.dto.AdminAuditEntry;
import com.acme.staticforge.api.dto.AdminAuditPage;
import com.acme.staticforge.api.dto.RecordPageView;
import com.acme.staticforge.audit.AuditLog;
import com.acme.staticforge.audit.AuditService;
import com.acme.staticforge.audit.AuditService.AuditFilter;
import com.acme.staticforge.common.ProblemFactory;
import com.acme.staticforge.common.SfException;
import com.acme.staticforge.project.Project;
import com.acme.staticforge.project.ProjectService;
import com.acme.staticforge.user.AppUser;
import com.acme.staticforge.user.UserService;
import com.acme.staticforge.user.UserStatus;
import java.time.Instant;
import java.time.format.DateTimeParseException;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.stream.Collectors;
import org.springdoc.core.annotations.ParameterObject;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.web.PageableDefault;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * The instance-wide audit trail (M26.3.1): {@code /api/v1/admin/audit}, instance admins only. Lists every entry, of
 * every project and of the instance itself; the per-project {@code AuditController} stays as it is. There is no purge
 * job: see {@link AuditService}.
 */
@RestController
@RequestMapping("/api/v1/admin/audit")
@PreAuthorize("hasAuthority('SYS_INSTANCE_ADMIN')")
public class AdminAuditController {

    /** The {@code project} value that selects the entries without a project. */
    static final String INSTANCE = "_instance";

    private static final int MAX_PAGE_SIZE = 200;

    private final AuditService auditService;
    private final ProjectService projectService;
    private final UserService userService;

    public AdminAuditController(AuditService auditService, ProjectService projectService, UserService userService) {
        this.auditService = auditService;
        this.projectService = projectService;
        this.userService = userService;
    }

    /**
     * Audit entries, newest first. {@code action} is repeatable (any of them matches); {@code project} is a project
     * key or {@value #INSTANCE}; {@code from} (inclusive) and {@code to} (exclusive) are ISO-8601 instants. The sort of
     * the page request is ignored: the order is always newest first. {@code size} is at most {@value #MAX_PAGE_SIZE}.
     */
    @GetMapping
    public AdminAuditPage list(
            @RequestParam(required = false) List<String> action,
            @RequestParam(required = false) Long userId,
            @RequestParam(required = false) String project,
            @RequestParam(required = false) String from,
            @RequestParam(required = false) String to,
            @ParameterObject @PageableDefault(size = 50) Pageable pageable) {
        if (pageable.getPageSize() > MAX_PAGE_SIZE) {
            throw new SfException(ProblemFactory.badRequest("size must be at most " + MAX_PAGE_SIZE + ".", "size"));
        }
        boolean instanceOnly = INSTANCE.equals(project);
        Long projectId = project == null || project.isBlank() || instanceOnly
                ? null
                : projectService.requireByKey(project).getId();
        Instant fromInstant = parseInstant(from, "from");
        Instant toInstant = parseInstant(to, "to");
        Set<String> actions = action == null
                ? Set.of()
                : action.stream()
                        .filter(a -> a != null && !a.isBlank())
                        .map(String::trim)
                        .collect(Collectors.toCollection(LinkedHashSet::new));

        Page<AuditLog> result = auditService.search(
                new AuditFilter(actions, userId, projectId, instanceOnly, fromInstant, toInstant), pageable);

        Map<Long, AppUser> actors = userService.findAllById(result.getContent().stream()
                .map(AuditLog::getActorUserId)
                .filter(Objects::nonNull)
                .collect(Collectors.toSet()));
        Map<Long, String> projectKeys =
                projectService.listAll().stream().collect(Collectors.toMap(Project::getId, Project::getKey));
        List<AdminAuditEntry> entries = result.getContent().stream()
                .map(entry -> toEntry(entry, actors, projectKeys))
                .toList();
        return new AdminAuditPage(
                entries,
                new RecordPageView.PageMeta(
                        result.getSize(), result.getNumber(), result.getTotalElements(), result.getTotalPages()));
    }

    /** The distinct action names in the trail, alphabetically (the view's action filter). */
    @GetMapping("/actions")
    public List<String> actions() {
        return auditService.actions();
    }

    private static AdminAuditEntry toEntry(AuditLog entry, Map<Long, AppUser> actors, Map<Long, String> projectKeys) {
        AdminAuditEntry.Actor actor = null;
        if (entry.getActorUserId() != null) {
            AppUser user = actors.get(entry.getActorUserId());
            actor = new AdminAuditEntry.Actor(entry.getActorUserId(), user == null ? null : actorName(user));
        }
        return new AdminAuditEntry(
                entry.getId(),
                entry.getCreatedAt(),
                entry.getAction(),
                actor,
                entry.getProjectId() == null ? null : projectKeys.get(entry.getProjectId()),
                entry.getTarget(),
                entry.getDetail());
    }

    /** A deleted account shows as its anonymized display name ({@code Deleted user}), not {@code deleted-user-<id>}. */
    private static String actorName(AppUser user) {
        return user.getStatus() == UserStatus.DELETED ? user.getDisplayName() : user.getUsername();
    }

    private static Instant parseInstant(String value, String field) {
        if (value == null || value.isBlank()) {
            return null;
        }
        try {
            return Instant.parse(value.trim());
        } catch (DateTimeParseException e) {
            throw new SfException(ProblemFactory.badRequest(
                    field + " must be an ISO-8601 instant such as 2026-09-24T12:00:00Z.", field));
        }
    }
}
