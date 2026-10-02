package com.acme.staticforge.api;

import com.acme.staticforge.api.dto.ProjectRestoreRequest;
import com.acme.staticforge.api.dto.RevisionView;
import com.acme.staticforge.common.ProblemFactory;
import com.acme.staticforge.common.SfException;
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

    /** Longest revision comment (the column's width). */
    private static final int MAX_COMMENT = 500;

    private final ProjectService projectService;
    private final ProjectRestoreService projectRestoreService;
    private final SecuritySupport securitySupport;
    private final CompactedReads compactedReads;
    private final RevisionViews views;

    public ProjectRestoreController(
            ProjectService projectService,
            ProjectRestoreService projectRestoreService,
            SecuritySupport securitySupport,
            CompactedReads compactedReads,
            RevisionViews views) {
        this.views = views;
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
                projectId, request.toRevision(), securitySupport.currentUserId(), comment(request));
        return ResponseEntity.ok().headers(compacted.getHeaders()).body(views.of(projectId, revision));
    }

    /** The request's comment, or "Project restore to N" when absent or blank; longer than 500 characters is a 400. */
    private static String comment(ProjectRestoreRequest request) {
        String comment = request.comment() == null ? "" : request.comment().strip();
        if (comment.length() > MAX_COMMENT) {
            throw new SfException(
                    ProblemFactory.badRequest("comment must be at most " + MAX_COMMENT + " characters.", "comment"));
        }
        return comment.isEmpty() ? "Project restore to " + request.toRevision() : comment;
    }
}
