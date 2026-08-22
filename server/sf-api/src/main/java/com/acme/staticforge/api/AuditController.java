package com.acme.staticforge.api;

import com.acme.staticforge.api.dto.AuditEntryView;
import com.acme.staticforge.audit.AuditLog;
import com.acme.staticforge.audit.AuditService;
import com.acme.staticforge.project.ProjectService;
import java.util.List;
import org.springframework.data.domain.Pageable;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * Project audit trail (spec §26.3). Read-only, restricted to {@code PROJECT_ADMIN} (and
 * instance admins implied by {@link ProjectAuthorizationService}). Each entry is a
 * security-relevant event, not a content revision.
 */
@RestController
@RequestMapping("/api/v1/projects/{projectKey}/audit")
public class AuditController {

    private final ProjectService projectService;
    private final AuditService auditService;

    public AuditController(ProjectService projectService, AuditService auditService) {
        this.projectService = projectService;
        this.auditService = auditService;
    }

    @GetMapping
    @PreAuthorize("@projectAuth.has(#projectKey, " + ProjectRoleExpr.ADMIN + ")")
    public List<AuditEntryView> list(@PathVariable String projectKey, Pageable pageable) {
        long projectId = projectService.requireByKey(projectKey).getId();
        return auditService.findRecent(projectId, pageable).stream().map(AuditController::toView).toList();
    }

    private static AuditEntryView toView(AuditLog entry) {
        return new AuditEntryView(
                entry.getId(),
                entry.getProjectId(),
                entry.getActorUserId(),
                entry.getAction(),
                entry.getTarget(),
                entry.getDetail(),
                entry.getCreatedAt());
    }
}
