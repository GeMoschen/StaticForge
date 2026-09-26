package com.acme.staticforge.security;

import com.acme.staticforge.common.ProblemFactory;
import com.acme.staticforge.common.SfException;
import com.acme.staticforge.project.ProjectRole;
import com.acme.staticforge.project.ProjectService;
import com.acme.staticforge.project.publish.PublishPermission;
import com.acme.staticforge.project.publish.PublishPolicy;
import com.acme.staticforge.project.publish.PublishRequirements;
import java.util.EnumSet;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import org.springframework.stereotype.Component;

/**
 * Per-project authorization (spec §8.4). Roles are resolved O(1) from the access token's
 * {@code projects} claim (already materialized into the {@link AuthenticatedUser}
 * principal), so no DB hit occurs. A non-member receives 404 rather than 403, hiding
 * project existence (spec §8.4).
 *
 * <p>Publishing operations (M28) are checked with {@link #can}: the role still comes from the token, the project's
 * publish policy from the database on every call — no cache — so a policy change applies on every editor's next request
 * without touching tokens (epic decision 4). A denial is {@code 403 SF-API-0403} naming what is missing under
 * {@code permission}. The scheduler evaluates the same rule for stored users ({@code PublishPermissionEvaluator}).
 */
@Component("projectAuth")
public class ProjectAuthorizationService {

    private final SecuritySupport securitySupport;
    private final ProjectService projectService;

    public ProjectAuthorizationService(SecuritySupport securitySupport, ProjectService projectService) {
        this.securitySupport = securitySupport;
        this.projectService = projectService;
    }

    /** Returns {@code true} if the caller holds {@code minimumRole} (or higher) in the project. */
    public boolean has(String projectKey, ProjectRole minimumRole) {
        AuthenticatedUser user = securitySupport.requireUser();
        if (user.isInstanceAdmin()) {
            return true;
        }
        Map<String, ProjectRole> roles = user.projectRoles();
        if (roles == null || !roles.containsKey(projectKey)) {
            throw new SfException(ProblemFactory.notFound("Project not found or not accessible."));
        }
        ProjectRole role = roles.get(projectKey);
        if (role.atLeast(minimumRole)) {
            return true;
        }
        throw new SfException(ProblemFactory.forbidden("Insufficient role for this project."));
    }

    /** Returns the caller's role in the project, or throws 404 when not a member. */
    public ProjectRole role(String projectKey) {
        AuthenticatedUser user = securitySupport.requireUser();
        if (user.isInstanceAdmin()) {
            return ProjectRole.PROJECT_ADMIN;
        }
        Map<String, ProjectRole> roles = user.projectRoles();
        if (roles == null || !roles.containsKey(projectKey)) {
            throw new SfException(ProblemFactory.notFound("Project not found or not accessible."));
        }
        return roles.get(projectKey);
    }
    /**
     * {@code @PreAuthorize("@projectAuth.can(#projectKey, 'RELEASE')")}: a publish permission name, or
     * {@code "ROLE:<role>"} for an operation no policy opens. An unknown literal is a programming error
     * ({@link IllegalArgumentException}; a test scans every annotation).
     */
    public boolean can(String projectKey, String requirement) {
        return satisfies(projectKey, PublishRequirements.parse(requirement));
    }

    /** Returns {@code true} if the caller holds {@code permission}; else {@code 403} naming it (404 for non-members). */
    public boolean can(String projectKey, PublishPermission permission) {
        return satisfies(projectKey, PublishRequirements.permission(permission));
    }

    /**
     * Returns {@code true} if the caller satisfies {@code requirements} in the project — for checks that depend on the
     * request body (a generation request, a schedule). Throws {@code 404} for non-members and {@code 403 SF-API-0403}
     * with {@code permission} = the first missing requirement otherwise.
     */
    public boolean satisfies(String projectKey, PublishRequirements requirements) {
        missing(projectKey, requirements).ifPresent(missing -> {
            throw new SfException(ProblemFactory.forbidden(denialMessage(missing), missing));
        });
        return true;
    }

    /** What the caller lacks for {@code requirements}, without throwing (still {@code 404} for non-members). */
    public Optional<String> missing(String projectKey, PublishRequirements requirements) {
        AuthenticatedUser user = securitySupport.requireUser();
        if (user.isInstanceAdmin()) {
            return Optional.empty();
        }
        ProjectRole role = role(projectKey);
        return requirements.missing(role, policyFor(projectKey, role, requirements.permissions()));
    }

    /** The caller's effective publish permissions in the project ({@code ProjectDetail.permissions}). */
    public Set<PublishPermission> permissions(String projectKey) {
        AuthenticatedUser user = securitySupport.requireUser();
        if (user.isInstanceAdmin()) {
            return EnumSet.allOf(PublishPermission.class);
        }
        ProjectRole role = role(projectKey);
        return policyFor(projectKey, role, EnumSet.allOf(PublishPermission.class)).effective(role);
    }

    /** The stored policy when it can matter — an editor asking for a permission — else nothing (no read). */
    private PublishPolicy policyFor(String projectKey, ProjectRole role, Set<PublishPermission> asked) {
        return role == ProjectRole.EDITOR && !asked.isEmpty()
                ? projectService.publishPolicy(projectKey)
                : PublishPolicy.EMPTY;
    }

    private static String denialMessage(String missing) {
        if (missing.startsWith(PublishRequirements.ROLE_PREFIX)) {
            return "Only " + missing.substring(PublishRequirements.ROLE_PREFIX.length()).toLowerCase(java.util.Locale.ROOT)
                    .replace('_', ' ') + "s and above may do this in this project.";
        }
        return "You need the " + missing + " permission for this; the project's publish policy decides which editors hold it.";
    }
}
