package com.acme.staticforge.api;

import com.acme.staticforge.api.dto.CreateFolderRequest;
import com.acme.staticforge.api.dto.FolderView;
import com.acme.staticforge.api.dto.LocaleReleaseView;
import com.acme.staticforge.api.dto.MoveRequest;
import com.acme.staticforge.api.dto.MoveResultDto;
import com.acme.staticforge.api.dto.RenameFolderRequest;
import com.acme.staticforge.api.dto.ScheduledRefView;
import com.acme.staticforge.api.dto.UpdateFolderRequest;
import com.acme.staticforge.asset.AssetService;
import com.acme.staticforge.asset.AssetType;
import com.acme.staticforge.asset.AssetVersionView;
import com.acme.staticforge.asset.folder.FolderNode;
import com.acme.staticforge.asset.folder.FolderScope;
import com.acme.staticforge.asset.folder.FolderService;
import com.acme.staticforge.asset.folder.StartPage;
import com.acme.staticforge.common.ProblemFactory;
import com.acme.staticforge.common.SfException;
import com.acme.staticforge.project.ProjectService;
import com.acme.staticforge.revision.RevisionContext;
import com.acme.staticforge.security.SecuritySupport;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.http.HttpHeaders;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/** Folder endpoints (spec §20.2). */
@RestController
@RequestMapping("/api/v1/projects/{projectKey}/folders")
public class FolderController {

    private final ProjectService projectService;
    private final FolderService folderService;
    private final SecuritySupport securitySupport;
    private final ReleaseBlocks releaseBlocks;
    private final AssetService assetService;

    public FolderController(
            ProjectService projectService,
            FolderService folderService,
            SecuritySupport securitySupport,
            ReleaseBlocks releaseBlocks,
            AssetService assetService) {
        this.projectService = projectService;
        this.folderService = folderService;
        this.assetService = assetService;
        this.securitySupport = securitySupport;
        this.releaseBlocks = releaseBlocks;
    }

    @GetMapping
    @PreAuthorize("@projectAuth.has(#projectKey, " + ProjectRoleExpr.VIEWER + ")")
    public List<FolderView> tree(
            @PathVariable String projectKey,
            @RequestParam String scope,
            @RequestParam(required = false) Integer depth) {
        int d = depth == null ? -1 : depth;
        long projectId = projectId(projectKey);
        List<FolderNode> nodes = folderService.tree(projectId, parseScope(scope), d, ctx(projectKey, null));
        // One status call for the whole tree, never one per node (M27.1.3).
        List<UUID> uuids = new java.util.ArrayList<>();
        collect(nodes, uuids);
        Map<UUID, Map<String, LocaleReleaseView>> release = releaseBlocks.of(projectId, uuids);
        Map<UUID, List<ScheduledRefView>> scheduled = releaseBlocks.scheduled(projectId, uuids);
        return nodes.stream().map(node -> toView(node, release, scheduled)).toList();
    }

    @PostMapping
    @PreAuthorize("@projectAuth.has(#projectKey, " + ProjectRoleExpr.EDITOR + ")")
    public ResponseEntity<FolderView> create(@PathVariable String projectKey, @RequestBody CreateFolderRequest body) {
        FolderScope scope = body.scope() == null || body.scope().isBlank() ? null : parseScope(body.scope());
        AssetType templateKind = body.templateKind() == null || body.templateKind().isBlank()
                ? null
                : parseTemplateKind(body.templateKind());
        AssetVersionView view = folderService.create(
                body.parentFolderUuid(), body.displayName(), scope, templateKind, ctx(projectKey, "create folder"));
        return ResponseEntity.ok(toView(projectId(projectKey), view));
    }

    private static FolderScope parseScope(String scope) {
        try {
            return FolderScope.valueOf(scope);
        } catch (IllegalArgumentException e) {
            throw new SfException(
                    ProblemFactory.badRequest("scope must be PAGES, MEDIA, NAVIGATION, TEMPLATES, GLOBALS, or CONTENT."));
        }
    }

    private static AssetType parseTemplateKind(String templateKind) {
        try {
            AssetType type = AssetType.valueOf(templateKind);
            if (type != AssetType.PAGE_TEMPLATE && type != AssetType.SECTION_TEMPLATE) {
                throw new IllegalArgumentException();
            }
            return type;
        } catch (IllegalArgumentException e) {
            throw new SfException(ProblemFactory.badRequest("templateKind must be PAGE_TEMPLATE or SECTION_TEMPLATE."));
        }
    }

    @PutMapping("/{uuid}")
    @PreAuthorize("@projectAuth.has(#projectKey, " + ProjectRoleExpr.EDITOR + ")")
    public FolderView rename(
            @PathVariable String projectKey,
            @PathVariable UUID uuid,
            @RequestHeader(value = "If-Match", required = false) String ifMatch,
            @RequestBody RenameFolderRequest body) {
        AssetVersionView view = folderService.update(
                uuid, body.displayName(), RevisionHeaders.expectedRevision(ifMatch), ctx(projectKey, "rename folder"));
        return toView(projectId(projectKey), view);
    }

    /**
     * Sets or clears a pages folder's start page (M31): {@code {"startPage": "<page uuid>" | null}}. A body without
     * {@code startPage} changes nothing and answers the current folder.
     */
    @PatchMapping("/{uuid}")
    @PreAuthorize("@projectAuth.has(#projectKey, " + ProjectRoleExpr.EDITOR + ")")
    public ResponseEntity<FolderView> update(
            @PathVariable String projectKey,
            @PathVariable UUID uuid,
            @RequestHeader(value = "If-Match", required = false) String ifMatch,
            @RequestBody UpdateFolderRequest body) {
        long expectedRevision = RevisionHeaders.expectedRevision(ifMatch);
        long projectId = projectId(projectKey);
        AssetVersionView view = body.hasStartPage()
                ? folderService.updateStartPage(uuid, body.getStartPage(), expectedRevision, ctx(projectKey, "set folder start page"))
                : currentFolder(projectId, uuid);
        return ResponseEntity.ok()
                .header(HttpHeaders.ETAG, RevisionHeaders.etag(view.validFromRevision()))
                .body(toView(projectId, view));
    }

    @PostMapping("/{uuid}/move")
    @PreAuthorize("@projectAuth.has(#projectKey, " + ProjectRoleExpr.EDITOR + ")")
    public MoveResultDto move(
            @PathVariable String projectKey,
            @PathVariable UUID uuid,
            @RequestHeader(value = "If-Match", required = false) String ifMatch,
            @RequestBody MoveRequest body) {
        var result = folderService.move(uuid, body.folderUuid(), ctx(projectKey, "move folder"));
        return new MoveResultDto(result.touchedAssetCount(), result.revision());
    }

    @DeleteMapping("/{uuid}")
    @PreAuthorize("@projectAuth.has(#projectKey, " + ProjectRoleExpr.EDITOR + ")")
    public ResponseEntity<Void> delete(
            @PathVariable String projectKey,
            @PathVariable UUID uuid,
            @RequestParam(defaultValue = "false") boolean cascade) {
        folderService.delete(uuid, cascade, ctx(projectKey, "delete folder"));
        return ResponseEntity.noContent().build();
    }

    private AssetVersionView currentFolder(long projectId, UUID uuid) {
        AssetVersionView view = assetService.requireCurrent(projectId, uuid);
        if (view.type() != AssetType.FOLDER || view.deleted()) {
            throw new SfException(ProblemFactory.notFound("Folder not found."));
        }
        return view;
    }

    private long projectId(String key) {
        return projectService.requireByKey(key).getId();
    }

    private RevisionContext ctx(String key, String comment) {
        return RevisionContext.of(projectId(key), securitySupport.currentUserId(), comment);
    }

    private static void collect(List<FolderNode> nodes, List<UUID> into) {
        for (FolderNode node : nodes) {
            into.add(node.uuid());
            collect(node.children(), into);
        }
    }

    private static FolderView toView(
            FolderNode node,
            Map<UUID, Map<String, LocaleReleaseView>> release,
            Map<UUID, List<ScheduledRefView>> scheduled) {
        return new FolderView(node.uuid(), node.uid(), node.displayName(), node.path(),
                node.scope() == null ? null : node.scope().name(), node.protectedFolder(), node.type().name(),
                node.recordCount(), node.revision(), node.startPage(), node.children().stream().map(child -> toView(child, release, scheduled)).toList(),
                release.get(node.uuid()), scheduled.getOrDefault(node.uuid(), List.of()));
    }

    private FolderView toView(long projectId, AssetVersionView v) {
        return toView(v, releaseBlocks.of(projectId, v.uuid()), releaseBlocks.scheduled(projectId, v.uuid()));
    }

    private static FolderView toView(
            AssetVersionView v, Map<String, LocaleReleaseView> release, List<ScheduledRefView> scheduled) {
        FolderScope scope = FolderScope.fromPayload(v.payload());
        return new FolderView(v.uuid(), v.uid(), v.displayName(), v.folderPath(), scope == null ? null : scope.name(),
                FolderScope.isProtected(v.payload()), AssetType.FOLDER.name(), null, v.validFromRevision(),
                scope == FolderScope.PAGES ? StartPage.fromPayload(v.payload()) : null, List.of(), release, scheduled);
    }
}
