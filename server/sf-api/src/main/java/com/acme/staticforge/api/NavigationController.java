package com.acme.staticforge.api;

import com.acme.staticforge.api.dto.CreatePageReferenceRequest;
import com.acme.staticforge.api.dto.NavTreeView;
import com.acme.staticforge.api.dto.NavigationFolderView;
import com.acme.staticforge.api.dto.NavigationStartNodeView;
import com.acme.staticforge.api.dto.PageReferenceResolveView;
import com.acme.staticforge.api.dto.PageReferenceView;
import com.acme.staticforge.api.dto.UpdatePageReferenceRequest;
import com.acme.staticforge.asset.AssetService;
import com.acme.staticforge.asset.AssetVersionView;
import com.acme.staticforge.asset.folder.FolderNode;
import com.acme.staticforge.asset.folder.FolderScope;
import com.acme.staticforge.asset.folder.FolderService;
import com.acme.staticforge.asset.folder.StartNode;
import com.acme.staticforge.asset.folder.StartNodeKind;
import com.acme.staticforge.asset.navigation.CreatePageReferenceCommand;
import com.acme.staticforge.asset.navigation.LiveNavigationLookup;
import com.acme.staticforge.asset.navigation.NavTreeNode;
import com.acme.staticforge.asset.navigation.NavigationService;
import com.acme.staticforge.asset.navigation.PageReferenceService;
import com.acme.staticforge.asset.navigation.PageReferenceTargetKind;
import com.acme.staticforge.common.ProblemFactory;
import com.acme.staticforge.common.SfException;
import com.acme.staticforge.project.ProjectService;
import com.acme.staticforge.revision.RevisionContext;
import com.acme.staticforge.security.SecuritySupport;
import com.acme.staticforge.template.diagnostic.Diagnostic;
import com.fasterxml.jackson.databind.JsonNode;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import org.springframework.http.HttpHeaders;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * Navigation store endpoints (spec §17, `M8.1.5`). Folder create/move/delete already go
 * through the generic, scope-parameterized {@link FolderController} (works for
 * {@code FolderScope.NAVIGATION} today with no changes needed there) — this controller adds
 * only what is specific to the navigation store: setting a folder's {@code startNode},
 * {@code PageReference} CRUD, and the two resolved-read endpoints ({@code tree}/{@code
 * resolve}) that the nav-store UI (`M8.1.6`) binds its live preview to.
 */
@RestController
@RequestMapping("/api/v1/projects/{projectKey}/navigation")
public class NavigationController {

    private final ProjectService projectService;
    private final FolderService folderService;
    private final PageReferenceService pageReferenceService;
    private final NavigationService navigationService;
    private final AssetService assetService;
    private final LiveNavigationLookup navigationLookup;
    private final SecuritySupport securitySupport;

    public NavigationController(
            ProjectService projectService,
            FolderService folderService,
            PageReferenceService pageReferenceService,
            NavigationService navigationService,
            AssetService assetService,
            LiveNavigationLookup navigationLookup,
            SecuritySupport securitySupport) {
        this.projectService = projectService;
        this.folderService = folderService;
        this.pageReferenceService = pageReferenceService;
        this.navigationService = navigationService;
        this.assetService = assetService;
        this.navigationLookup = navigationLookup;
        this.securitySupport = securitySupport;
    }

    /** The full, resolved navigation tree rooted at the project's single navigation-root folder. */
    @GetMapping("/tree")
    @PreAuthorize("@projectAuth.has(#projectKey, " + ProjectRoleExpr.VIEWER + ")")
    public NavTreeView tree(@PathVariable String projectKey, @RequestParam(required = false) Integer depth) {
        int d = depth == null ? -1 : depth;
        UUID rootUuid = navigationRootUuid(projectKey);
        List<Diagnostic> diagnostics = new ArrayList<>();
        NavTreeNode root = navigationService.tree(rootUuid, d, navigationLookup, diagnostics);
        if (root == null) {
            throw new SfException(ProblemFactory.notFound("Navigation root folder not found."));
        }
        return toView(root);
    }

    private NavTreeView toView(NavTreeNode node) {
        String path = node.resolvedPageUuid() == null ? null : assetService.requireCurrent(node.resolvedPageUuid()).folderPath();
        return new NavTreeView(
                node.assetUuid(), node.type().name(), node.uid(), node.displayName(), node.label(),
                node.resolvedPageUuid(), path, node.children().stream().map(this::toView).toList());
    }

    /** Renames a navigation folder and/or sets (or clears) its {@code startNode}. */
    @PatchMapping("/folders/{uuid}")
    @PreAuthorize("@projectAuth.has(#projectKey, " + ProjectRoleExpr.EDITOR + ")")
    public ResponseEntity<NavigationFolderView> updateFolder(
            @PathVariable String projectKey,
            @PathVariable UUID uuid,
            @RequestHeader(value = "If-Match", required = false) String ifMatch,
            @RequestBody JsonNode body) {
        long expectedRevision = RevisionHeaders.expectedRevision(ifMatch);
        AssetVersionView view = null;

        if (body.hasNonNull("displayName")) {
            view = folderService.update(uuid, body.get("displayName").asText(), expectedRevision, ctx(projectKey, "rename navigation folder"));
            expectedRevision = view.validFromRevision();
        }
        if (body.has("startNode")) {
            JsonNode startNodeNode = body.get("startNode");
            StartNode startNode = startNodeNode == null || startNodeNode.isNull() ? null : readStartNode(startNodeNode);
            view = folderService.updateStartNode(uuid, startNode, expectedRevision, ctx(projectKey, "update navigation folder startNode"));
        }
        if (view == null) {
            view = assetService.requireCurrent(uuid);
        }
        return ResponseEntity.ok().header(HttpHeaders.ETAG, RevisionHeaders.etag(view.validFromRevision())).body(toFolderView(view));
    }

    @PostMapping("/references")
    @PreAuthorize("@projectAuth.has(#projectKey, " + ProjectRoleExpr.EDITOR + ")")
    public ResponseEntity<PageReferenceView> createReference(
            @PathVariable String projectKey, @RequestBody CreatePageReferenceRequest body) {
        AssetVersionView view = pageReferenceService.create(
                new CreatePageReferenceCommand(
                        body.displayName(), body.folderUuid(), parseTargetKind(body.targetKind()), body.targetAssetUuid(), body.label()),
                ctx(projectKey, "create page reference"));
        return ResponseEntity.ok().header(HttpHeaders.ETAG, RevisionHeaders.etag(view.validFromRevision())).body(toReferenceView(view));
    }

    @PatchMapping("/references/{uuid}")
    @PreAuthorize("@projectAuth.has(#projectKey, " + ProjectRoleExpr.EDITOR + ")")
    public ResponseEntity<PageReferenceView> updateReference(
            @PathVariable String projectKey,
            @PathVariable UUID uuid,
            @RequestHeader(value = "If-Match", required = false) String ifMatch,
            @RequestBody UpdatePageReferenceRequest body) {
        AssetVersionView view = pageReferenceService.update(
                uuid,
                parseTargetKind(body.targetKind()),
                body.targetAssetUuid(),
                body.label(),
                RevisionHeaders.expectedRevision(ifMatch),
                ctx(projectKey, "update page reference"));
        return ResponseEntity.ok().header(HttpHeaders.ETAG, RevisionHeaders.etag(view.validFromRevision())).body(toReferenceView(view));
    }

    @DeleteMapping("/references/{uuid}")
    @PreAuthorize("@projectAuth.has(#projectKey, " + ProjectRoleExpr.EDITOR + ")")
    public ResponseEntity<Void> deleteReference(
            @PathVariable String projectKey, @PathVariable UUID uuid, @RequestParam(defaultValue = "false") boolean force) {
        pageReferenceService.find(uuid); // 404s / 422s if uuid isn't a live PageReference
        assetService.softDelete(uuid, force, ctx(projectKey, "delete page reference"));
        return ResponseEntity.noContent().build();
    }

    /** The page a {@code PageReference} currently resolves to, plus its canonical path, for the UI's live preview. */
    @GetMapping("/references/{uuid}/resolve")
    @PreAuthorize("@projectAuth.has(#projectKey, " + ProjectRoleExpr.VIEWER + ")")
    public PageReferenceResolveView resolve(@PathVariable String projectKey, @PathVariable UUID uuid) {
        pageReferenceService.find(uuid); // 404s if uuid isn't a live PageReference
        UUID pageUuid = navigationService.resolve(uuid, navigationLookup);
        if (pageUuid == null) {
            return new PageReferenceResolveView(null, null);
        }
        AssetVersionView page = assetService.requireCurrent(pageUuid);
        return new PageReferenceResolveView(page.uuid(), page.folderPath());
    }

    private UUID navigationRootUuid(String projectKey) {
        List<FolderNode> tree = folderService.tree(projectId(projectKey), FolderScope.NAVIGATION, 0, ctx(projectKey, null));
        if (tree.isEmpty()) {
            throw new SfException(ProblemFactory.notFound("Navigation root folder not found."));
        }
        return tree.get(0).uuid();
    }

    private static StartNode readStartNode(JsonNode node) {
        String kind = node.path("kind").asText(null);
        String assetUuid = node.path("assetUuid").asText(null);
        if (kind == null || assetUuid == null) {
            throw new SfException(ProblemFactory.badRequest("startNode requires kind and assetUuid."));
        }
        try {
            return new StartNode(StartNodeKind.valueOf(kind), UUID.fromString(assetUuid));
        } catch (IllegalArgumentException e) {
            throw new SfException(ProblemFactory.badRequest("Invalid startNode: " + node));
        }
    }

    private static PageReferenceTargetKind parseTargetKind(String kind) {
        try {
            return PageReferenceTargetKind.valueOf(kind);
        } catch (IllegalArgumentException | NullPointerException e) {
            throw new SfException(ProblemFactory.badRequest("targetKind must be PAGE or FOLDER."));
        }
    }

    private long projectId(String key) {
        return projectService.requireByKey(key).getId();
    }

    private RevisionContext ctx(String key, String comment) {
        return RevisionContext.of(projectId(key), securitySupport.currentUserId(), comment);
    }

    private static NavigationFolderView toFolderView(AssetVersionView v) {
        StartNode startNode = StartNode.fromPayload(v.payload());
        NavigationStartNodeView startNodeView =
                startNode == null ? null : new NavigationStartNodeView(startNode.kind().name(), startNode.assetUuid());
        return new NavigationFolderView(v.uuid(), v.uid(), v.displayName(), v.validFromRevision(), v.folderPath(), startNodeView);
    }

    private static PageReferenceView toReferenceView(AssetVersionView v) {
        JsonNode payload = v.payload();
        String targetKind = payload.path("target").path("kind").asText(null);
        String targetUuidText = payload.path("target").path("assetUuid").asText(null);
        UUID targetUuid = targetUuidText == null ? null : UUID.fromString(targetUuidText);
        String label = payload.path("label").isMissingNode() || payload.path("label").isNull()
                ? null
                : payload.path("label").asText();
        return new PageReferenceView(v.uuid(), v.uid(), v.displayName(), v.validFromRevision(), v.folderPath(), targetKind, targetUuid, label);
    }
}
