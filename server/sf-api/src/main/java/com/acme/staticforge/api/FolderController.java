package com.acme.staticforge.api;

import com.acme.staticforge.api.dto.CreateFolderRequest;
import com.acme.staticforge.api.dto.FolderView;
import com.acme.staticforge.api.dto.MoveRequest;
import com.acme.staticforge.api.dto.MoveResultDto;
import com.acme.staticforge.api.dto.RenameFolderRequest;
import com.acme.staticforge.asset.AssetType;
import com.acme.staticforge.asset.AssetVersionView;
import com.acme.staticforge.asset.folder.FolderNode;
import com.acme.staticforge.asset.folder.FolderScope;
import com.acme.staticforge.asset.folder.FolderService;
import com.acme.staticforge.common.ProblemFactory;
import com.acme.staticforge.common.SfException;
import com.acme.staticforge.project.ProjectService;
import com.acme.staticforge.revision.RevisionContext;
import com.acme.staticforge.security.SecuritySupport;
import java.util.List;
import java.util.UUID;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
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

    public FolderController(ProjectService projectService, FolderService folderService, SecuritySupport securitySupport) {
        this.projectService = projectService;
        this.folderService = folderService;
        this.securitySupport = securitySupport;
    }

    @GetMapping
    @PreAuthorize("@projectAuth.has(#projectKey, " + ProjectRoleExpr.VIEWER + ")")
    public List<FolderView> tree(
            @PathVariable String projectKey,
            @RequestParam String scope,
            @RequestParam(required = false) Integer depth) {
        int d = depth == null ? -1 : depth;
        List<FolderNode> nodes = folderService.tree(projectId(projectKey), parseScope(scope), d, ctx(projectKey, null));
        return nodes.stream().map(FolderController::toView).toList();
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
        return ResponseEntity.ok(toView(view));
    }

    private static FolderScope parseScope(String scope) {
        try {
            return FolderScope.valueOf(scope);
        } catch (IllegalArgumentException e) {
            throw new SfException(ProblemFactory.badRequest("scope must be PAGES, MEDIA, NAVIGATION, or TEMPLATES."));
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
        return toView(view);
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

    private long projectId(String key) {
        return projectService.requireByKey(key).getId();
    }

    private RevisionContext ctx(String key, String comment) {
        return RevisionContext.of(projectId(key), securitySupport.currentUserId(), comment);
    }

    private static FolderView toView(FolderNode node) {
        return new FolderView(node.uuid(), node.uid(), node.displayName(), node.path(),
                node.scope() == null ? null : node.scope().name(), node.protectedFolder(),
                node.children().stream().map(FolderController::toView).toList());
    }

    private static FolderView toView(AssetVersionView v) {
        FolderScope scope = FolderScope.fromPayload(v.payload());
        return new FolderView(v.uuid(), v.uid(), v.displayName(), v.folderPath(), scope == null ? null : scope.name(),
                FolderScope.isProtected(v.payload()), List.of());
    }
}
