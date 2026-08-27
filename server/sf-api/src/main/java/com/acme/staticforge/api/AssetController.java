package com.acme.staticforge.api;

import com.acme.staticforge.api.dto.AffectedTemplate;
import com.acme.staticforge.api.dto.AssetDetailView;
import com.acme.staticforge.api.dto.AssetHistoryEntry;
import com.acme.staticforge.api.dto.AssetSummaryView;
import com.acme.staticforge.api.dto.MoveRequest;
import com.acme.staticforge.api.dto.RenameAssetRequest;
import com.acme.staticforge.api.dto.RestoreRequest;
import com.acme.staticforge.api.dto.UidChangeRequest;
import com.acme.staticforge.api.dto.UidChangeResult;
import com.acme.staticforge.api.dto.UsageDto;
import com.acme.staticforge.asset.AssetQuery;
import com.acme.staticforge.asset.AssetService;
import com.acme.staticforge.asset.AssetSummary;
import com.acme.staticforge.asset.AssetType;
import com.acme.staticforge.asset.AssetVersionView;
import com.acme.staticforge.asset.UidLiteralReference;
import com.acme.staticforge.asset.UpdateAssetCommand;
import com.acme.staticforge.asset.UsageView;
import com.acme.staticforge.asset.folder.FolderService;
import com.acme.staticforge.project.ProjectService;
import com.acme.staticforge.revision.RevisionContext;
import com.acme.staticforge.security.SecuritySupport;
import java.util.List;
import java.util.UUID;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.http.HttpHeaders;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * Generic asset endpoints (spec §20.2). Thin controller: resolves the project, delegates to
 * {@link AssetService}, and maps to DTOs.
 */
@RestController
@RequestMapping("/api/v1/projects/{projectKey}/assets")
public class AssetController {

    private final ProjectService projectService;
    private final AssetService assetService;
    private final FolderService folderService;
    private final SecuritySupport securitySupport;

    public AssetController(ProjectService projectService, AssetService assetService,
            FolderService folderService, SecuritySupport securitySupport) {
        this.projectService = projectService;
        this.assetService = assetService;
        this.folderService = folderService;
        this.securitySupport = securitySupport;
    }

    @GetMapping
    @PreAuthorize("@projectAuth.has(#projectKey, " + ProjectRoleExpr.VIEWER + ")")
    public Page<AssetSummaryView> list(
            @PathVariable String projectKey,
            @RequestParam(required = false) String type,
            @RequestParam(required = false) String q,
            @RequestParam(required = false) String folder,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "50") int size) {
        long projectId = projectId(projectKey);
        AssetType assetType = type == null ? null : AssetType.valueOf(type.toUpperCase());
        Page<AssetSummary> result = assetService.search(
                new AssetQuery(projectId, assetType, folder, q), PageRequest.of(page, size));
        return result.map(AssetController::toSummary);
    }

    @GetMapping("/{uuid}")
    @PreAuthorize("@projectAuth.has(#projectKey, " + ProjectRoleExpr.VIEWER + ")")
    public ResponseEntity<AssetDetailView> detail(@PathVariable String projectKey, @PathVariable UUID uuid) {
        AssetVersionView view = assetService.requireCurrent(projectId(projectKey), uuid);
        return ResponseEntity.ok().header(HttpHeaders.ETAG, RevisionHeaders.etag(view.validFromRevision())).body(toDetail(view));
    }

    @GetMapping("/{uuid}/usages")
    @PreAuthorize("@projectAuth.has(#projectKey, " + ProjectRoleExpr.VIEWER + ")")
    public List<UsageDto> usages(@PathVariable String projectKey, @PathVariable UUID uuid) {
        return assetService.usages(projectId(projectKey), uuid).stream().map(AssetController::toUsage).toList();
    }

    @GetMapping("/{uuid}/history")
    @PreAuthorize("@projectAuth.has(#projectKey, " + ProjectRoleExpr.VIEWER + ")")
    public List<AssetHistoryEntry> history(@PathVariable String projectKey, @PathVariable UUID uuid) {
        return assetService.history(projectId(projectKey), uuid).stream().map(AssetController::toHistory).toList();
    }

    @GetMapping("/{uuid}/versions/{revision}")
    @PreAuthorize("@projectAuth.has(#projectKey, " + ProjectRoleExpr.VIEWER + ")")
    public AssetDetailView version(@PathVariable String projectKey, @PathVariable UUID uuid, @PathVariable long revision) {
        AssetVersionView view = assetService.findAt(projectId(projectKey), uuid, revision)
                .orElseThrow(() -> new com.acme.staticforge.common.SfException(
                        com.acme.staticforge.common.ProblemFactory.notFound("No version at revision " + revision + ".")));
        return toDetail(view);
    }

    @PostMapping("/{uuid}/restore")
    @PreAuthorize("@projectAuth.has(#projectKey, " + ProjectRoleExpr.EDITOR + ")")
    public AssetDetailView restore(@PathVariable String projectKey, @PathVariable UUID uuid, @RequestBody RestoreRequest body) {
        AssetVersionView view = assetService.restore(uuid, body.fromRevision(), ctx(projectKey, "restore"));
        return toDetail(view);
    }

    @PatchMapping("/{uuid}/uid")
    @PreAuthorize("@projectAuth.has(#projectKey, " + ProjectRoleExpr.DEVELOPER + ")")
    public UidChangeResult changeUid(
            @PathVariable String projectKey, @PathVariable UUID uuid, @RequestBody UidChangeRequest body) {
        com.acme.staticforge.asset.UidChangeResult result =
                assetService.changeUid(uuid, body.uid(), ctx(projectKey, "uid change"));
        return new UidChangeResult(
                result.oldUid(),
                result.newUid(),
                result.affectedTemplates().stream().map(AssetController::toAffectedTemplate).toList());
    }

    @PatchMapping("/{uuid}/display-name")
    @PreAuthorize("@projectAuth.has(#projectKey, " + ProjectRoleExpr.EDITOR + ")")
    public AssetDetailView renameDisplayName(
            @PathVariable String projectKey,
            @PathVariable UUID uuid,
            @RequestHeader(value = "If-Match", required = false) String ifMatch,
            @RequestBody RenameAssetRequest body) {
        AssetVersionView current = assetService.requireCurrent(projectId(projectKey), uuid);
        AssetVersionView view = assetService.update(
                uuid,
                new UpdateAssetCommand(body.displayName(), current.payload()),
                RevisionHeaders.expectedRevision(ifMatch),
                ctx(projectKey, "rename display name"));
        return toDetail(view);
    }

    @PostMapping("/{uuid}/move")
    @PreAuthorize("@projectAuth.has(#projectKey, " + ProjectRoleExpr.EDITOR + ")")
    public ResponseEntity<?> move(
            @PathVariable String projectKey, @PathVariable UUID uuid, @RequestBody MoveRequest body) {
        AssetVersionView current = assetService.requireCurrent(projectId(projectKey), uuid);
        RevisionContext revisionContext = ctx(projectKey, "move");
        if (current.type() == AssetType.FOLDER) {
            return ResponseEntity.ok(toMoveResult(folderService.move(uuid, body.folderUuid(), revisionContext)));
        }
        return ResponseEntity.ok(toDetail(assetService.move(uuid, body.folderUuid(), revisionContext)));
    }

    @DeleteMapping("/{uuid}")
    @PreAuthorize("@projectAuth.has(#projectKey, " + ProjectRoleExpr.EDITOR + ")")
    public ResponseEntity<Void> delete(
            @PathVariable String projectKey, @PathVariable UUID uuid, @RequestParam(defaultValue = "false") boolean force) {
        assetService.softDelete(uuid, force, ctx(projectKey, "delete"));
        return ResponseEntity.noContent().build();
    }

    private long projectId(String key) {
        return projectService.requireByKey(key).getId();
    }

    private RevisionContext ctx(String key, String comment) {
        return RevisionContext.of(projectId(key), securitySupport.currentUserId(), comment);
    }

    private static AssetSummaryView toSummary(AssetSummary s) {
        return new AssetSummaryView(s.uuid(), s.uid(), s.type().name(), s.displayName(), s.folderPath(), s.validFromRevision());
    }

    private static AssetDetailView toDetail(AssetVersionView v) {
        return new AssetDetailView(
                v.uuid(), v.uid(), v.type().name(), v.displayName(), v.payload(), v.validFromRevision(),
                v.deleted(), v.folderPath(), v.changedBy(), v.changedAt());
    }

    private static UsageDto toUsage(UsageView u) {
        return new UsageDto(u.fromUuid(), u.fromUid(), u.fromType().name(), u.kind().name(), u.sourcePath());
    }

    private static AffectedTemplate toAffectedTemplate(UidLiteralReference ref) {
        return new AffectedTemplate(ref.assetUuid(), ref.assetUid(), ref.assetType().name(), ref.displayName(), ref.channelKey());
    }

    private static AssetHistoryEntry toHistory(AssetVersionView v) {
        return new AssetHistoryEntry(v.validFromRevision(), v.displayName(), v.deleted(), v.changedBy(), v.changedAt());
    }

    private static com.acme.staticforge.api.dto.MoveResultDto toMoveResult(
            com.acme.staticforge.asset.folder.MoveResult m) {
        return new com.acme.staticforge.api.dto.MoveResultDto(m.touchedAssetCount(), m.revision());
    }
}
