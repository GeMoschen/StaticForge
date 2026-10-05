package com.acme.staticforge.api;

import com.acme.staticforge.api.dto.AffectedTemplate;
import com.acme.staticforge.api.dto.AssetDetailView;
import com.acme.staticforge.api.dto.AssetHistoryEntry;
import com.acme.staticforge.api.dto.AssetCopyView;
import com.acme.staticforge.api.dto.AssetSummaryView;
import com.acme.staticforge.api.dto.DuplicateAssetRequest;
import com.acme.staticforge.api.dto.MoveRequest;
import com.acme.staticforge.api.dto.RenameAssetRequest;
import com.acme.staticforge.api.dto.RestoreRequest;
import com.acme.staticforge.api.dto.ScheduledRefView;
import com.acme.staticforge.api.dto.UidChangeRequest;
import com.acme.staticforge.api.dto.UidChangeResult;
import com.acme.staticforge.api.dto.UsageDto;
import com.acme.staticforge.asset.AssetQuery;
import com.acme.staticforge.asset.AssetService;
import com.acme.staticforge.asset.AssetSummary;
import com.acme.staticforge.asset.AssetType;
import com.acme.staticforge.asset.AssetVersionView;
import com.acme.staticforge.asset.RecordNaming;
import com.acme.staticforge.asset.UidLiteralReference;
import com.acme.staticforge.asset.UpdateAssetCommand;
import com.acme.staticforge.asset.UsageView;
import com.acme.staticforge.common.ProblemFactory;
import com.acme.staticforge.common.SfException;
import com.acme.staticforge.asset.folder.FolderService;
import com.acme.staticforge.asset.transfer.AssetTransferService;
import com.acme.staticforge.project.ProjectService;
import com.acme.staticforge.revision.AssetDiff;
import com.acme.staticforge.revision.DiffService;
import com.acme.staticforge.revision.RevisionContext;
import com.acme.staticforge.security.SecuritySupport;
import java.util.List;
import java.util.Map;
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
    private final AssetTransferService assetTransferService;
    private final SecuritySupport securitySupport;
    private final ReleaseBlocks releaseBlocks;
    private final CompactedReads compactedReads;
    private final RevisionViews revisionViews;
    private final DiffService diffService;

    public AssetController(ProjectService projectService, AssetService assetService,
            FolderService folderService, SecuritySupport securitySupport, ReleaseBlocks releaseBlocks,
            CompactedReads compactedReads, RevisionViews revisionViews, DiffService diffService,
            AssetTransferService assetTransferService) {
        this.assetTransferService = assetTransferService;
        this.revisionViews = revisionViews;
        this.diffService = diffService;
        this.compactedReads = compactedReads;
        this.projectService = projectService;
        this.assetService = assetService;
        this.folderService = folderService;
        this.securitySupport = securitySupport;
        this.releaseBlocks = releaseBlocks;
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
        List<UUID> uuids = result.getContent().stream().map(AssetSummary::uuid).toList();
        var release = releaseBlocks.of(projectId, uuids);
        var scheduled = releaseBlocks.scheduled(projectId, uuids);
        return result.map(s -> toSummary(s, release.get(s.uuid()), scheduled.getOrDefault(s.uuid(), List.of())));
    }

    @GetMapping("/{uuid}")
    @PreAuthorize("@projectAuth.has(#projectKey, " + ProjectRoleExpr.VIEWER + ")")
    public ResponseEntity<AssetDetailView> detail(@PathVariable String projectKey, @PathVariable UUID uuid) {
        AssetVersionView view = assetService.requireCurrent(projectId(projectKey), uuid);
        return ResponseEntity.ok().header(HttpHeaders.ETAG, RevisionHeaders.etag(view.validFromRevision())).body(toDetail(projectKey, view));
    }

    @GetMapping("/{uuid}/usages")
    @PreAuthorize("@projectAuth.has(#projectKey, " + ProjectRoleExpr.VIEWER + ")")
    public List<UsageDto> usages(
            @PathVariable String projectKey,
            @PathVariable UUID uuid,
            @RequestParam(required = false) Long revision) {
        long projectId = projectId(projectKey);
        List<UsageView> usages = revision == null
                ? assetService.usages(projectId, uuid)
                : assetService.usagesAt(projectId, uuid, revision);
        return usages.stream().map(AssetController::toUsage).toList();
    }

    @GetMapping("/{uuid}/history")
    @PreAuthorize("@projectAuth.has(#projectKey, " + ProjectRoleExpr.VIEWER + ")")
    public ResponseEntity<List<AssetHistoryEntry>> history(
            @PathVariable String projectKey,
            @PathVariable UUID uuid,
            @RequestParam(required = false) Integer page,
            @RequestParam(required = false) Integer size) {
        List<AssetVersionView> all = assetService.history(projectId(projectKey), uuid);
        // Paged only when asked for (page or size given), newest first like the full list; X-Total-Count is the whole.
        List<AssetVersionView> slice = all;
        if (page != null || size != null) {
            int pageSize = size == null ? 20 : size;
            int pageNumber = page == null ? 0 : page;
            if (pageNumber < 0 || pageSize < 1) {
                throw new SfException(ProblemFactory.badRequest("page must be >= 0 and size >= 1.", "size"));
            }
            long from = Math.min((long) pageNumber * pageSize, all.size());
            slice = all.subList((int) from, (int) Math.min(all.size(), from + pageSize));
        }
        Map<Long, String> names = revisionViews.displayNames(slice.stream().map(AssetVersionView::changedBy).toList());
        return ResponseEntity.ok()
                .header(RevisionController.TOTAL_COUNT_HEADER, Integer.toString(all.size()))
                .body(slice.stream().map(v -> toHistory(v, names)).toList());
    }

    /** Diff of the asset's content as of revision {@code from} against {@code to} (default: its current state). */
    @GetMapping("/{uuid}/diff")
    @PreAuthorize("@projectAuth.has(#projectKey, " + ProjectRoleExpr.VIEWER + ")")
    public AssetDiff diff(
            @PathVariable String projectKey,
            @PathVariable UUID uuid,
            @RequestParam long from,
            @RequestParam(required = false) Long to) {
        return diffService.diffAsset(projectId(projectKey), uuid, from, to);
    }

    @GetMapping("/{uuid}/versions/{revision}")
    @PreAuthorize("@projectAuth.has(#projectKey, " + ProjectRoleExpr.VIEWER + ")")
    public AssetDetailView version(@PathVariable String projectKey, @PathVariable UUID uuid, @PathVariable long revision) {
        long projectId = projectId(projectKey);
        AssetVersionView view = assetService.findAt(projectId, uuid, revision)
                .orElseThrow(() -> new com.acme.staticforge.common.SfException(
                        com.acme.staticforge.common.ProblemFactory.notFound("No version at revision " + revision + ".")));
        // A past version has no current release status or schedule of its own. compacted (M29.4.3): the exact state at
        // the revision was absorbed; this is the state at the end of its group.
        return toDetail(view, null, null, compactedReads.compacted(projectId, uuid, revision));
    }

    @PostMapping("/{uuid}/restore")
    @PreAuthorize("@projectAuth.has(#projectKey, " + ProjectRoleExpr.EDITOR + ")")
    public AssetDetailView restore(@PathVariable String projectKey, @PathVariable UUID uuid, @RequestBody RestoreRequest body) {
        // compacted (M29.4.3): the revision restored from shows compacted history, so what was restored is the
        // surviving version (the state at the end of its group), not the exact state at that revision.
        boolean compacted = compactedReads.compacted(projectId(projectKey), uuid, body.fromRevision());
        AssetVersionView view = assetService.restore(uuid, body.fromRevision(), ctx(projectKey, "restore"));
        return toDetail(projectKey, view, compacted);
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
        if (current.type() == AssetType.RECORD) {
            throw new SfException(RecordNaming.derived());
        }
        AssetVersionView view = assetService.update(
                uuid,
                new UpdateAssetCommand(body.displayName(), current.payload()),
                RevisionHeaders.expectedRevision(ifMatch),
                ctx(projectKey, "rename display name"));
        return toDetail(projectKey, view);
    }

    @PostMapping("/{uuid}/move")
    @PreAuthorize("@projectAuth.has(#projectKey, " + ProjectRoleExpr.EDITOR + ")")
    public ResponseEntity<?> move(
            @PathVariable String projectKey, @PathVariable UUID uuid, @RequestBody MoveRequest body) {
        AssetTransferService.MoveOutcome moved =
                assetTransferService.move(uuid, body.folderUuid(), ctx(projectKey, "move"));
        if (moved.folder() != null) {
            return ResponseEntity.ok(toMoveResult(moved.folder()));
        }
        return ResponseEntity.ok(toDetail(projectKey, moved.asset()));
    }

    /**
     * Copies an asset (page, record, record set, navigation item, media file or global set; not a folder) as a
     * new unreleased draft named "&lt;name&gt; copy" ("copy 2", ...), unique within the target. The optional body
     * {@code {"folderUuid"}} names the target folder (a record set for a record); absent or {@code null} copies
     * into the asset's own folder. One transaction: a refusal writes nothing. {@code 201} with the copy and its
     * {@code ETag}; {@code 404} for an unknown or deleted asset or target, {@code 422} for a folder, an
     * unsupported type or a target the containment rules refuse.
     */
    @PostMapping("/{uuid}/duplicate")
    @PreAuthorize("@projectAuth.has(#projectKey, " + ProjectRoleExpr.EDITOR + ")")
    public ResponseEntity<AssetCopyView> duplicate(
            @PathVariable String projectKey,
            @PathVariable UUID uuid,
            @RequestBody(required = false) DuplicateAssetRequest body) {
        AssetVersionView copy = assetTransferService.duplicate(
                uuid, body == null ? null : body.folderUuid(), ctx(projectKey, "duplicate"));
        UUID folderUuid = assetTransferService.parentUuid(copy);
        return ResponseEntity.status(201)
                .header(HttpHeaders.ETAG, RevisionHeaders.etag(copy.validFromRevision()))
                .body(new AssetCopyView(
                        copy.uuid(), copy.uid(), copy.type().name(), copy.displayName(), folderUuid, copy.folderPath(),
                        copy.validFromRevision()));
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

    private static AssetSummaryView toSummary(
            AssetSummary s,
            java.util.Map<String, com.acme.staticforge.api.dto.LocaleReleaseView> release,
            List<ScheduledRefView> scheduled) {
        return new AssetSummaryView(
                s.uuid(), s.uid(), s.type().name(), s.displayName(), s.folderPath(), s.validFromRevision(), release, scheduled);
    }

    private AssetDetailView toDetail(String projectKey, AssetVersionView v) {
        return toDetail(projectKey, v, false);
    }

    private AssetDetailView toDetail(String projectKey, AssetVersionView v, boolean compacted) {
        long projectId = projectId(projectKey);
        return toDetail(v, releaseBlocks.of(projectId, v.uuid()), releaseBlocks.scheduled(projectId, v.uuid()), compacted);
    }

    private static AssetDetailView toDetail(
            AssetVersionView v,
            java.util.Map<String, com.acme.staticforge.api.dto.LocaleReleaseView> release,
            List<ScheduledRefView> scheduled,
            boolean compacted) {
        return new AssetDetailView(
                v.uuid(), v.uid(), v.type().name(), v.displayName(), v.payload(), v.validFromRevision(),
                v.deleted(), v.folderPath(), v.changedBy(), v.changedAt(), release, scheduled, compacted);
    }

    private static UsageDto toUsage(UsageView u) {
        return new UsageDto(u.fromUuid(), u.fromUid(), u.fromType().name(), u.kind().name(), u.sourcePath());
    }

    private static AffectedTemplate toAffectedTemplate(UidLiteralReference ref) {
        return new AffectedTemplate(ref.assetUuid(), ref.assetUid(), ref.assetType().name(), ref.displayName(), ref.channelKey());
    }

    private static AssetHistoryEntry toHistory(AssetVersionView v, Map<Long, String> names) {
        return new AssetHistoryEntry(
                v.validFromRevision(), v.displayName(), v.deleted(), v.changedBy(),
                v.changedBy() == null ? null : names.get(v.changedBy()), v.changedAt());
    }

    private static com.acme.staticforge.api.dto.MoveResultDto toMoveResult(
            com.acme.staticforge.asset.folder.MoveResult m) {
        return new com.acme.staticforge.api.dto.MoveResultDto(m.touchedAssetCount(), m.revision());
    }
}
