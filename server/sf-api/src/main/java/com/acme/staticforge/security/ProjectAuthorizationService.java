package com.acme.staticforge.security;

import com.acme.staticforge.common.ProblemFactory;
import com.acme.staticforge.common.SfException;
import com.acme.staticforge.project.ProjectRole;
import java.util.Map;
import org.springframework.stereotype.Component;

/**
 * Per-project authorization (spec §8.4). Roles are resolved O(1) from the access token's
 * {@code projects} claim (already materialized into the {@link AuthenticatedUser}
 * principal), so no DB hit occurs. A non-member receives 404 rather than 403, hiding
 * project existence (spec §8.4).
 */
@Component("projectAuth")
public class ProjectAuthorizationService {

    private final SecuritySupport securitySupport;

    public ProjectAuthorizationService(SecuritySupport securitySupport) {
        this.securitySupport = securitySupport;
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
}
