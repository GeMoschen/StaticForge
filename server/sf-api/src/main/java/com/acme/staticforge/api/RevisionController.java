package com.acme.staticforge.api;

import com.acme.staticforge.api.dto.RevisionView;
import com.acme.staticforge.project.ProjectService;
import com.acme.staticforge.revision.DiffService;
import com.acme.staticforge.revision.Revision;
import com.acme.staticforge.revision.RevisionDiff;
import com.acme.staticforge.revision.RevisionService;
import java.util.List;
import java.util.UUID;
import org.springframework.data.domain.Pageable;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/** Revision listing, detail and diff (spec §20.2 Revisions). */
@RestController
@RequestMapping("/api/v1/projects/{projectKey}/revisions")
public class RevisionController {

    private final ProjectService projectService;
    private final RevisionService revisionService;
    private final DiffService diffService;

    public RevisionController(
            ProjectService projectService, RevisionService revisionService, DiffService diffService) {
        this.projectService = projectService;
        this.revisionService = revisionService;
        this.diffService = diffService;
    }

    @GetMapping
    @PreAuthorize("@projectAuth.has(#projectKey, " + ProjectRoleExpr.VIEWER + ")")
    public List<RevisionView> list(
            @PathVariable String projectKey,
            @RequestParam(required = false) Long since,
            @RequestParam(required = false) Long userId,
            @RequestParam(required = false) UUID assetUuid,
            Pageable pageable) {
        long projectId = projectService.requireByKey(projectKey).getId();
        return revisionService.findRecent(projectId, since, userId, assetUuid, pageable).stream()
                .map(this::toView)
                .toList();
    }

    @GetMapping("/{revisionId}")
    @PreAuthorize("@projectAuth.has(#projectKey, " + ProjectRoleExpr.VIEWER + ")")
    public RevisionView get(@PathVariable String projectKey, @PathVariable long revisionId) {
        long projectId = projectService.requireByKey(projectKey).getId();
        return revisionService
                .find(projectId, revisionId)
                .map(this::toView)
                .orElseThrow(() -> new com.acme.staticforge.common.SfException(
                        com.acme.staticforge.common.ProblemFactory.notFound("Revision not found.")));
    }

    @GetMapping("/{revisionId}/diff")
    @PreAuthorize("@projectAuth.has(#projectKey, " + ProjectRoleExpr.VIEWER + ")")
    public RevisionDiff diff(@PathVariable String projectKey, @PathVariable long revisionId) {
        long projectId = projectService.requireByKey(projectKey).getId();
        return diffService.diff(projectId, revisionId);
    }

    private RevisionView toView(Revision r) {
        return new RevisionView(
                r.getProjectId(),
                r.getRevisionId(),
                r.getCreatedAt(),
                r.getCreatedBy(),
                r.getChangeType().name(),
                r.getComment(),
                r.getSummary());
    }
}
