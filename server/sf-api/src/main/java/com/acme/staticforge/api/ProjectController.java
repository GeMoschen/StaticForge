package com.acme.staticforge.api;

import com.acme.staticforge.api.dto.CodeHighlightingView;
import com.acme.staticforge.api.dto.LocaleWarningView;
import com.acme.staticforge.api.dto.ProjectCreateRequest;
import com.acme.staticforge.api.dto.ProjectDetail;
import com.acme.staticforge.api.dto.ProjectLocalesRequest;
import com.acme.staticforge.api.dto.ProjectLocalesView;
import com.acme.staticforge.api.dto.ProjectMemberView;
import com.acme.staticforge.api.dto.ProjectSummary;
import com.acme.staticforge.api.dto.ProjectUpdateRequest;
import com.acme.staticforge.api.dto.PublishPolicyView;
import com.acme.staticforge.api.dto.SetMemberRoleRequest;
import com.acme.staticforge.common.ProblemFactory;
import com.acme.staticforge.common.Problem;
import com.acme.staticforge.common.SfException;
import com.acme.staticforge.project.CodeHighlighting;
import com.acme.staticforge.project.LocaleConfig;
import com.acme.staticforge.project.Project;
import com.acme.staticforge.project.ProjectLocale;
import com.acme.staticforge.project.ProjectMember;
import com.acme.staticforge.project.ProjectRole;
import com.acme.staticforge.project.ProjectService;
import com.acme.staticforge.project.publish.PublishPolicy;
import com.acme.staticforge.revision.RevisionContext;
import com.acme.staticforge.security.AuthenticatedUser;
import com.acme.staticforge.security.ProjectAuthorizationService;
import com.acme.staticforge.security.SecuritySupport;
import com.acme.staticforge.template.diagnostic.DiagnosticCodes;
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
import org.springframework.web.bind.annotation.RequestParam;
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
    private final ProjectAuthorizationService projectAuth;
    private final SecuritySupport securitySupport;

    public ProjectController(
            ProjectService projectService,
            UserService userService,
            SecuritySupport securitySupport,
            ProjectAuthorizationService projectAuth) {
        this.projectService = projectService;
        this.userService = userService;
        this.securitySupport = securitySupport;
        this.projectAuth = projectAuth;
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
        // Archived projects are hidden from everyone but instance admins (M26).
        return projectService.listAll().stream()
                .filter(p -> roleByProject.containsKey(p.getId()) && !p.isArchived())
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
        return toDetail(projectService.update(
                projectKey, body.name(), body.description(), body.allowedMimeTypes(), ctx(projectKey, null)));
    }

    /**
     * Replaces the code highlighting overrides (M33 follow-up). {@code 400 SF-API-0400} with one message per bad entry
     * under {@code errors}; identical overrides answer {@code 200} and record nothing.
     */
    @PutMapping("/{key}/code-highlighting")
    @PreAuthorize("@projectAuth.has(#projectKey, " + ROLE_EXPR + ".PROJECT_ADMIN)")
    public ProjectDetail updateCodeHighlighting(
            @PathVariable("key") String projectKey, @RequestBody CodeHighlightingView body) {
        try {
            projectService.updateCodeHighlighting(
                    projectKey, new CodeHighlighting(body.extensions(), body.mimeTypes()), ctx(projectKey, null));
        } catch (ProjectService.InvalidCodeHighlightingException e) {
            throw new SfException(Problem.builder()
                    .type("https://cms.example.com/problems/sf-api-0400")
                    .title("Bad Request")
                    .status(400)
                    .detail("The code highlighting overrides are invalid.")
                    .property("code", "SF-API-0400")
                    .property("errors", e.errors())
                    .build());
        }
        return toDetail(projectService.requireByKey(projectKey));
    }

    @GetMapping("/{key}/locales")
    @PreAuthorize("@projectAuth.has(#projectKey, " + ROLE_EXPR + ".VIEWER)")
    public ProjectLocalesView locales(@PathVariable("key") String projectKey) {
        LocaleConfig config = projectService.locales(projectKey);
        return new ProjectLocalesView(
                localeViews(config), config.defaultLocale(), config.fallbacks(), config.defaultWithoutPrefix(),
                false, List.of(), 0, false, 0, List.of(), List.of(), 0);
    }

    @PutMapping("/{key}/locales")
    @PreAuthorize("@projectAuth.has(#projectKey, " + ROLE_EXPR + ".PROJECT_ADMIN)")
    public ProjectLocalesView updateLocales(
            @PathVariable("key") String projectKey,
            @RequestParam(value = "confirmDiscard", defaultValue = "false") boolean confirmDiscard,
            @RequestBody ProjectLocalesRequest body) {
        LocaleConfig config = toConfig(body);
        ProjectService.LocaleUpdateResult result =
                projectService.updateLocales(projectKey, config, confirmDiscard, ctx(projectKey, null));
        return toLocalesView(result);
    }

    /** Normalizes and validates the request body, mapping findings onto {@code errors} field entries. */
    private static LocaleConfig toConfig(ProjectLocalesRequest body) {
        List<ProjectLocale> declared = (body.locales() == null ? List.<ProjectLocalesRequest.LocaleEntry>of() : body.locales())
                .stream()
                .map(e -> new ProjectLocale(e == null ? null : e.code(), e == null ? null : e.label()))
                .toList();
        try {
            return LocaleConfig.of(declared, body.defaultLocale(), body.fallbacks(), body.defaultWithoutPrefix());
        } catch (LocaleConfig.LocaleConfigException e) {
            throw new SfException(Problem.builder()
                    .type("https://cms.example.com/problems/sf-api-0400")
                    .title("Bad Request")
                    .status(400)
                    .detail("The locale configuration is invalid.")
                    .property("code", "SF-API-0400")
                    .property("errors", e.errors())
                    .build());
        }
    }

    private static ProjectLocalesView toLocalesView(ProjectService.LocaleUpdateResult result) {
        LocaleConfig config = result.config();
        return new ProjectLocalesView(
                localeViews(config),
                config.defaultLocale(),
                config.fallbacks(),
                config.defaultWithoutPrefix(),
                result.urlsWillChange(),
                result.removedLocales(),
                result.retainedValueCount(),
                result.confirmationRequired(),
                result.discardedLocaleValues(),
                result.affectedAssets().stream().map(java.util.UUID::toString).collect(Collectors.toList()),
                result.warnings().stream()
                        .limit(ProjectLocalesView.MAX_WARNINGS)
                        .map(w -> new LocaleWarningView(
                                DiagnosticCodes.GEN_OUTPUT_PATH_NOT_LOCALE_DISTINCT, w.message(), w.templateUuid(),
                                w.templateUid(), w.templateName(), w.channel(), w.outputPath()))
                        .toList(),
                result.warnings().size());
    }

    private static List<ProjectLocalesView.ProjectLocaleView> localeViews(LocaleConfig config) {
        return config.locales().stream()
                .map(l -> new ProjectLocalesView.ProjectLocaleView(l.code(), l.label()))
                .collect(Collectors.toList());
    }

    @AllowedOnArchivedProject("Archiving an archived project changes nothing.")
    @PostMapping("/{key}/archive")
    @PreAuthorize("hasAuthority('SYS_INSTANCE_ADMIN')")
    public ResponseEntity<Void> archive(@PathVariable("key") String projectKey) {
        projectService.archive(projectKey, ctx(projectKey, null));
        return ResponseEntity.noContent().build();
    }

    /** Reverses {@code archive} (M26): the project is writable again and back in its members' lists. */
    @AllowedOnArchivedProject("The one write that reverses archiving.")
    @PostMapping("/{key}/unarchive")
    @PreAuthorize("hasAuthority('SYS_INSTANCE_ADMIN')")
    public ResponseEntity<Void> unarchive(@PathVariable("key") String projectKey) {
        projectService.unarchive(projectKey, ctx(projectKey, null));
        return ResponseEntity.noContent().build();
    }

    @GetMapping("/{key}/members")
    @PreAuthorize("@projectAuth.has(#projectKey, " + ROLE_EXPR + ".VIEWER)")
    public List<ProjectMemberView> members(@PathVariable("key") String projectKey) {
        boolean showEmails = projectAuth.role(projectKey) == ProjectRole.PROJECT_ADMIN;
        return projectService.members(projectKey).stream()
                .map(member -> toMemberView(member, showEmails))
                .collect(Collectors.toList());
    }

    @PutMapping("/{key}/members/{userId}")
    @PreAuthorize("@projectAuth.has(#projectKey, " + ROLE_EXPR + ".PROJECT_ADMIN)")
    public ProjectMemberView setMemberRole(
            @PathVariable("key") String projectKey,
            @PathVariable("userId") Long userId,
            @Valid @RequestBody SetMemberRoleRequest body) {
        userService.requireById(userId);
        ProjectRole role = parseRole(body.role());
        projectService.setMemberRole(projectKey, userId, role, ctx(projectKey, null));
        ProjectMember member = projectService.members(projectKey).stream()
                .filter(m -> m.getUserId().equals(userId))
                .findFirst()
                .orElseThrow(() -> new SfException(ProblemFactory.notFound("Member not found.")));
        return toMemberView(member, true);
    }

    @DeleteMapping("/{key}/members/{userId}")
    @PreAuthorize("@projectAuth.has(#projectKey, " + ROLE_EXPR + ".PROJECT_ADMIN)")
    public ResponseEntity<Void> removeMember(
            @PathVariable("key") String projectKey, @PathVariable("userId") Long userId) {
        projectService.removeMember(projectKey, userId, ctx(projectKey, null));
        return ResponseEntity.noContent().build();
    }

    /** Builds the {@link RevisionContext} for a by-key project mutation (resolves the numeric project id). */
    private RevisionContext ctx(String projectKey, String comment) {
        return RevisionContext.of(projectService.requireByKey(projectKey).getId(), securitySupport.currentUserId(), comment);
    }

    /** Emails are private (M26): only project admins and instance admins see them. */
    private ProjectMemberView toMemberView(ProjectMember member, boolean showEmail) {
        AppUser user = userService.findById(member.getUserId()).orElse(null);
        return new ProjectMemberView(
                member.getUserId(),
                user != null ? user.getUsername() : null,
                user != null ? user.getDisplayName() : null,
                user != null && showEmail ? user.getEmail() : null,
                user != null ? user.getStatus().name() : null,
                member.getRole().name(),
                member.getGrantedAt(),
                member.getGrantedBy());
    }

    private static ProjectSummary toSummary(Project project, ProjectRole role) {
        return new ProjectSummary(
                project.getKey(), project.getName(), project.getDescription(), role.name(), project.isArchived());
    }

    private ProjectDetail toDetail(Project project) {
        return new ProjectDetail(
                project.getKey(),
                project.getName(),
                project.getDescription(),
                project.isArchived(),
                project.getCreatedAt(),
                project.getCreatedBy(),
                project.allowedMimeTypesList(),
                new PublishPolicyView(PublishPolicy.fromJson(project.getPublishPolicy()).editor().stream()
                        .map(Enum::name)
                        .toList()),
                projectAuth.permissions(project.getKey()).stream().map(Enum::name).toList(),
                project.getCompactedThrough(),
                codeHighlightingView(CodeHighlighting.fromJson(project.getCodeHighlighting())));
    }

    private static CodeHighlightingView codeHighlightingView(CodeHighlighting highlighting) {
        return new CodeHighlightingView(highlighting.extensions(), highlighting.mimeTypes());
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
