package com.acme.staticforge.api;

import com.acme.staticforge.api.dto.ProjectRestoreRequest;
import com.acme.staticforge.api.dto.RevisionView;
import com.acme.staticforge.project.ProjectService;
import com.acme.staticforge.revision.ProjectRestoreService;
import com.acme.staticforge.revision.Revision;
import com.acme.staticforge.security.SecuritySupport;
import org.springframework.http.ResponseEntity;
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
    private final CompactedReads compactedReads;

    public ProjectRestoreController(
            ProjectService projectService,
            ProjectRestoreService projectRestoreService,
            SecuritySupport securitySupport,
            CompactedReads compactedReads) {
        this.projectService = projectService;
        this.projectRestoreService = projectRestoreService;
        this.securitySupport = securitySupport;
        this.compactedReads = compactedReads;
    }

    @PostMapping("/restore")
    @PreAuthorize("@projectAuth.has(#projectKey, " + ProjectRoleExpr.ADMIN + ")")
    public ResponseEntity<RevisionView> restore(
            @PathVariable String projectKey, @RequestBody ProjectRestoreRequest request) {
        long projectId = projectService.requireByKey(projectKey).getId();
        // Checked before the restore writes: whether the state restored is compacted (X-SF-Compacted, M29.4.3).
        ResponseEntity<Void> compacted =
                compactedReads.markSnapshot(ResponseEntity.ok().build(), projectId, request.toRevision());
        Revision revision = projectRestoreService.restoreTo(
                projectId, request.toRevision(), securitySupport.currentUserId(), "Project restore to " + request.toRevision());
        return ResponseEntity.ok().headers(compacted.getHeaders()).body(new RevisionView(
                revision.getProjectId(),
                revision.getRevisionId(),
                revision.getCreatedAt(),
                revision.getCreatedBy(),
                revision.getChangeType().name(),
                revision.getComment(),
                revision.getSummary(),
                revision.isCompacted()));
    }
}
