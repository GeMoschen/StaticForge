package com.acme.staticforge.api;

import com.acme.staticforge.api.dto.RevisionView;
import com.acme.staticforge.asset.Asset;
import com.acme.staticforge.asset.AssetRepository;
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
    private final AssetRepository assetRepository;

    public RevisionController(
            ProjectService projectService, RevisionService revisionService, DiffService diffService,
            AssetRepository assetRepository) {
        this.projectService = projectService;
        this.revisionService = revisionService;
        this.diffService = diffService;
        this.assetRepository = assetRepository;
    }

    @GetMapping
    @PreAuthorize("@projectAuth.has(#projectKey, " + ProjectRoleExpr.VIEWER + ")")
    public List<RevisionView> list(
            @PathVariable String projectKey,
            @RequestParam(required = false) Long since,
            @RequestParam(required = false) Long userId,
            @RequestParam(required = false) String assetUuid,
            Pageable pageable) {
        long projectId = projectService.requireByKey(projectKey).getId();
        UUID resolved = resolveAssetRef(projectId, assetUuid);
        if (assetUuid != null && !assetUuid.isBlank() && resolved == null) {
            return List.of();
        }
        return revisionService.findRecent(projectId, since, userId, resolved, pageable).stream()
                .map(this::toView)
                .toList();
    }

    /** Accepts either an asset UUID or its short UID (the "Asset" filter's placeholder promises both). Unparseable/unknown refs resolve to {@code null} rather than a 500. */
    private UUID resolveAssetRef(long projectId, String ref) {
        if (ref == null || ref.isBlank()) {
            return null;
        }
        String trimmed = ref.trim();
        try {
            return UUID.fromString(trimmed);
        } catch (IllegalArgumentException e) {
            return assetRepository.findByProjectIdAndUid(projectId, trimmed).map(Asset::getUuid).orElse(null);
        }
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
                r.getSummary(),
                r.isCompacted());
    }
}
