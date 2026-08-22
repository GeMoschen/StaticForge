package com.acme.staticforge.api;

import com.acme.staticforge.api.dto.ProjectRestoreRequest;
import com.acme.staticforge.api.dto.RevisionView;
import com.acme.staticforge.project.ProjectService;
import com.acme.staticforge.revision.ProjectRestoreService;
import com.acme.staticforge.revision.Revision;
import com.acme.staticforge.security.SecuritySupport;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** Project-wide rollback (spec §7.6, §20.2). */
@RestController
@RequestMapping("/api/v1/projects/{projectKey}")
public class ProjectRestoreController {

    private final ProjectService projectService;
    private final ProjectRestoreService projectRestoreService;
    private final SecuritySupport securitySupport;

    public ProjectRestoreController(
            ProjectService projectService, ProjectRestoreService projectRestoreService, SecuritySupport securitySupport) {
        this.projectService = projectService;
        this.projectRestoreService = projectRestoreService;
        this.securitySupport = securitySupport;
    }

    @PostMapping("/restore")
    @PreAuthorize("@projectAuth.has(#projectKey, " + ProjectRoleExpr.ADMIN + ")")
    public RevisionView restore(@PathVariable String projectKey, @RequestBody ProjectRestoreRequest request) {
        long projectId = projectService.requireByKey(projectKey).getId();
        Revision revision = projectRestoreService.restoreTo(
                projectId, request.toRevision(), securitySupport.currentUserId(), "Project restore to " + request.toRevision());
        return new RevisionView(
                revision.getProjectId(),
                revision.getRevisionId(),
                revision.getCreatedAt(),
                revision.getCreatedBy(),
                revision.getChangeType().name(),
                revision.getComment(),
                revision.getSummary());
    }
}
