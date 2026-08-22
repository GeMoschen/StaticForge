package com.acme.staticforge.api;

import com.acme.staticforge.api.dto.ProjectCreateRequest;
import com.acme.staticforge.api.dto.ProjectDetail;
import com.acme.staticforge.api.dto.ProjectMemberView;
import com.acme.staticforge.api.dto.ProjectSummary;
import com.acme.staticforge.api.dto.ProjectUpdateRequest;
import com.acme.staticforge.api.dto.SetMemberRoleRequest;
import com.acme.staticforge.common.ProblemFactory;
import com.acme.staticforge.common.SfException;
import com.acme.staticforge.project.Project;
import com.acme.staticforge.project.ProjectMember;
import com.acme.staticforge.project.ProjectRole;
import com.acme.staticforge.project.ProjectService;
import com.acme.staticforge.security.AuthenticatedUser;
import com.acme.staticforge.security.SecuritySupport;
import com.acme.staticforge.user.AppUser;
import com.acme.staticforge.user.UserService;
import jakarta.validation.Valid;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * Projects and membership endpoints (spec §20.2). Thin controller: authorizes, validates,
 * delegates to {@link ProjectService}, and maps to DTOs.
 */
@RestController
@RequestMapping("/api/v1/projects")
public class ProjectController {

    private static final String ROLE_EXPR = "T(com.acme.staticforge.project.ProjectRole)";

    private final ProjectService projectService;
    private final UserService userService;
    private final SecuritySupport securitySupport;

    public ProjectController(ProjectService projectService, UserService userService, SecuritySupport securitySupport) {
        this.projectService = projectService;
        this.userService = userService;
        this.securitySupport = securitySupport;
    }

    @GetMapping
    public List<ProjectSummary> list() {
        AuthenticatedUser user = securitySupport.requireUser();
        if (user.isInstanceAdmin()) {
            return projectService.listAll().stream()
                    .map(p -> toSummary(p, ProjectRole.PROJECT_ADMIN))
                    .collect(Collectors.toList());
        }

        Map<Long, ProjectRole> roleByProject = projectService.membershipsOf(user.id()).stream()
                .collect(Collectors.toMap(ProjectMember::getProjectId, ProjectMember::getRole));
        return projectService.listAll().stream()
                .filter(p -> roleByProject.containsKey(p.getId()))
                .sorted(Comparator.comparing(Project::getKey))
                .map(p -> toSummary(p, roleByProject.get(p.getId())))
                .collect(Collectors.toList());
    }

    @PostMapping
    @PreAuthorize("hasAuthority('SYS_INSTANCE_ADMIN')")
    public ResponseEntity<ProjectDetail> create(@Valid @RequestBody ProjectCreateRequest body) {
        Long actingUserId = securitySupport.currentUserId();
        Project project = projectService.create(
                new com.acme.staticforge.project.CreateProjectRequest(
                        body.key(), body.name(), body.description(), null),
                actingUserId);
        return ResponseEntity.created(location(project.getKey())).body(toDetail(project));
    }

    @GetMapping("/{key}")
    @PreAuthorize("@projectAuth.has(#projectKey, " + ROLE_EXPR + ".VIEWER)")
    public ProjectDetail detail(@PathVariable("key") String projectKey) {
        return toDetail(projectService.requireByKey(projectKey));
    }

    @PutMapping("/{key}")
    @PreAuthorize("@projectAuth.has(#projectKey, " + ROLE_EXPR + ".PROJECT_ADMIN)")
    public ProjectDetail update(@PathVariable("key") String projectKey, @Valid @RequestBody ProjectUpdateRequest body) {
        Long actingUserId = securitySupport.currentUserId();
        return toDetail(projectService.update(projectKey, body.name(), body.description(), actingUserId, null));
    }

    @PostMapping("/{key}/archive")
    @PreAuthorize("hasAuthority('SYS_INSTANCE_ADMIN')")
    public ResponseEntity<Void> archive(@PathVariable("key") String projectKey) {
        Long actingUserId = securitySupport.currentUserId();
        projectService.archive(projectKey, actingUserId, null);
        return ResponseEntity.noContent().build();
    }

    @GetMapping("/{key}/members")
    @PreAuthorize("@projectAuth.has(#projectKey, " + ROLE_EXPR + ".VIEWER)")
    public List<ProjectMemberView> members(@PathVariable("key") String projectKey) {
        return projectService.members(projectKey).stream().map(this::toMemberView).collect(Collectors.toList());
    }

    @PutMapping("/{key}/members/{userId}")
    @PreAuthorize("@projectAuth.has(#projectKey, " + ROLE_EXPR + ".PROJECT_ADMIN)")
    public ProjectMemberView setMemberRole(
            @PathVariable("key") String projectKey,
            @PathVariable("userId") Long userId,
            @Valid @RequestBody SetMemberRoleRequest body) {
        userService.requireById(userId);
        ProjectRole role = parseRole(body.role());
        Long actingUserId = securitySupport.currentUserId();
        projectService.setMemberRole(projectKey, userId, role, actingUserId, null);
        ProjectMember member = projectService.members(projectKey).stream()
                .filter(m -> m.getUserId().equals(userId))
                .findFirst()
                .orElseThrow(() -> new SfException(ProblemFactory.notFound("Member not found.")));
        return toMemberView(member);
    }

    @DeleteMapping("/{key}/members/{userId}")
    @PreAuthorize("@projectAuth.has(#projectKey, " + ROLE_EXPR + ".PROJECT_ADMIN)")
    public ResponseEntity<Void> removeMember(
            @PathVariable("key") String projectKey, @PathVariable("userId") Long userId) {
        Long actingUserId = securitySupport.currentUserId();
        projectService.removeMember(projectKey, userId, actingUserId, null);
        return ResponseEntity.noContent().build();
    }

    private ProjectMemberView toMemberView(ProjectMember member) {
        AppUser user = userService.findById(member.getUserId()).orElse(null);
        return new ProjectMemberView(
                member.getUserId(),
                user != null ? user.getUsername() : null,
                user != null ? user.getDisplayName() : null,
                user != null ? user.getEmail() : null,
                member.getRole().name(),
                member.getGrantedAt(),
                member.getGrantedBy());
    }

    private static ProjectSummary toSummary(Project project, ProjectRole role) {
        return new ProjectSummary(
                project.getKey(), project.getName(), project.getDescription(), role.name(), project.isArchived());
    }

    private static ProjectDetail toDetail(Project project) {
        return new ProjectDetail(
                project.getKey(),
                project.getName(),
                project.getDescription(),
                project.isArchived(),
                project.getCreatedAt(),
                project.getCreatedBy());
    }

    private static ProjectRole parseRole(String role) {
        try {
            return ProjectRole.fromName(role);
        } catch (IllegalArgumentException e) {
            throw new SfException(ProblemFactory.badRequest("Unknown project role: " + role));
        }
    }

    private static URI location(String key) {
        return URI.create("/api/v1/projects/" + java.net.URLEncoder.encode(key, StandardCharsets.UTF_8));
    }
}
