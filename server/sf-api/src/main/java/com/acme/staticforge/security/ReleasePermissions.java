package com.acme.staticforge.security;

import com.acme.staticforge.project.ProjectRole;
import org.springframework.stereotype.Component;

/**
 * Who may change release state through the API (M27.1.3, epic decision 15) — one method per operation, used as
 * {@code @PreAuthorize("@releasePermissions.canRelease(#projectKey)")}. In M27 every operation needs
 * {@code DEVELOPER}; M28 swaps these bodies for the project's publish policy without touching a controller. Like
 * {@link ProjectAuthorizationService#has}, a non-member gets {@code 404} and a member below the rule {@code 403}.
 */
@Component("releasePermissions")
public class ReleasePermissions {

    private final ProjectAuthorizationService projectAuth;

    public ReleasePermissions(ProjectAuthorizationService projectAuth) {
        this.projectAuth = projectAuth;
    }

    public boolean canRelease(String projectKey) {
        return projectAuth.has(projectKey, ProjectRole.DEVELOPER);
    }

    public boolean canUnpublish(String projectKey) {
        return projectAuth.has(projectKey, ProjectRole.DEVELOPER);
    }

    public boolean canDiscard(String projectKey) {
        return projectAuth.has(projectKey, ProjectRole.DEVELOPER);
    }

    /** Scheduling a release or unpublish (M27.4.4). */
    public boolean canSchedule(String projectKey) {
        return projectAuth.has(projectKey, ProjectRole.DEVELOPER);
    }
}
