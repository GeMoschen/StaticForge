package com.acme.staticforge.api;

import com.acme.staticforge.api.dto.CreatePageReferenceRequest;
import com.acme.staticforge.api.dto.NavTreeView;
import com.acme.staticforge.api.dto.NavigationFolderView;
import com.acme.staticforge.api.dto.NavigationStartNodeView;
import com.acme.staticforge.api.dto.PageReferenceResolveView;
import com.acme.staticforge.api.dto.PageReferenceView;
import com.acme.staticforge.api.dto.ScheduledRefView;
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
import java.util.Objects;
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

    private final com.acme.staticforge.project.ProjectLocales projectLocales;
    private final ReleaseBlocks releaseBlocks;

    public NavigationController(
            ProjectService projectService,
            FolderService folderService,
            PageReferenceService pageReferenceService,
            NavigationService navigationService,
            AssetService assetService,
            LiveNavigationLookup navigationLookup,
            SecuritySupport securitySupport,
            com.acme.staticforge.project.ProjectLocales projectLocales,
            ReleaseBlocks releaseBlocks) {
        this.releaseBlocks = releaseBlocks;
        this.projectService = projectService;
        this.folderService = folderService;
        this.pageReferenceService = pageReferenceService;
        this.navigationService = navigationService;
        this.assetService = assetService;
        this.navigationLookup = navigationLookup;
        this.securitySupport = securitySupport;
        this.projectLocales = projectLocales;
    }

    /**
     * The fully-resolved navigation forest, `nav:` reference-resolved by {@link
     * NavigationService#tree}. Always exactly one top-level entry today: the fixed, protected
     * "All Navigation" root folder (spec M13.1.2-style, generalized) — real content nests inside
     * it, one level down.
     */
    @GetMapping("/tree")
    @PreAuthorize("@projectAuth.has(#projectKey, " + ProjectRoleExpr.VIEWER + ")")
    public List<NavTreeView> tree(
            @PathVariable String projectKey,
            @RequestParam(required = false) Integer depth,
            @RequestParam(value = "locale", required = false) String locale) {
        int d = depth == null ? -1 : depth;
        long projectId = projectId(projectKey);
        List<Diagnostic> diagnostics = new ArrayList<>();
        List<String> chain = projectLocales.forProject(projectId).effectiveChain(locale);
        List<NavTreeNode> roots = topLevelNavigationUuids(projectKey).stream()
                .map(uuid -> navigationService.tree(projectId, uuid, d, navigationLookup, diagnostics, chain))
                .filter(Objects::nonNull)
                .toList();
        List<UUID> uuids = new ArrayList<>();
        collect(roots, uuids);
        java.util.Map<UUID, java.util.Map<String, com.acme.staticforge.api.dto.LocaleReleaseView>> release =
                releaseBlocks.of(projectId, uuids);
        java.util.Map<UUID, List<ScheduledRefView>> scheduled = releaseBlocks.scheduled(projectId, uuids);
        return roots.stream().map(node -> toView(projectId, node, release, scheduled)).toList();
    }

    private static void collect(List<NavTreeNode> nodes, List<UUID> into) {
        for (NavTreeNode node : nodes) {
            into.add(node.assetUuid());
            collect(node.children(), into);
        }
    }

    private NavTreeView toView(
            long projectId,
            NavTreeNode node,
            java.util.Map<UUID, java.util.Map<String, com.acme.staticforge.api.dto.LocaleReleaseView>> release,
            java.util.Map<UUID, List<ScheduledRefView>> scheduled) {
        String path = node.resolvedPageUuid() == null
                ? null
                : assetService.requireCurrent(projectId, node.resolvedPageUuid()).folderPath();
        return new NavTreeView(
                node.assetUuid(), node.type().name(), node.uid(), node.displayName(), node.label(),
                node.resolvedPageUuid(), path, node.protectedFolder(),
                assetService.requireCurrent(projectId, node.assetUuid()).validFromRevision(),
                node.children().stream().map(c -> toView(projectId, c, release, scheduled)).toList(),
                release.get(node.assetUuid()),
                scheduled.getOrDefault(node.assetUuid(), List.of()));
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
            view = assetService.requireCurrent(projectId(projectKey), uuid);
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
        return ResponseEntity.ok().header(HttpHeaders.ETAG, RevisionHeaders.etag(view.validFromRevision())).body(toReferenceView(view, List.of(), releaseBlocks.of(projectId(projectKey), view.uuid()),
                releaseBlocks.scheduled(projectId(projectKey), view.uuid())));
    }

    @PatchMapping("/references/{uuid}")
    @PreAuthorize("@projectAuth.has(#projectKey, " + ProjectRoleExpr.EDITOR + ")")
    public ResponseEntity<PageReferenceView> updateReference(
            @PathVariable String projectKey,
            @PathVariable UUID uuid,
            @RequestHeader(value = "If-Match", required = false) String ifMatch,
            @RequestParam(value = "locale", required = false) String locale,
            @RequestBody UpdatePageReferenceRequest body) {
        AssetVersionView view = pageReferenceService.update(
                uuid,
                parseTargetKind(body.targetKind()),
                body.targetAssetUuid(),
                body.label(),
                locale,
                RevisionHeaders.expectedRevision(ifMatch),
                ctx(projectKey, "update page reference"));
        return ResponseEntity.ok().header(HttpHeaders.ETAG, RevisionHeaders.etag(view.validFromRevision()))
                .body(toReferenceView(
                        view,
                        projectLocales.forProject(projectId(projectKey)).effectiveChain(locale),
                        releaseBlocks.of(projectId(projectKey), view.uuid()),
                        releaseBlocks.scheduled(projectId(projectKey), view.uuid())));
    }

    @DeleteMapping("/references/{uuid}")
    @PreAuthorize("@projectAuth.has(#projectKey, " + ProjectRoleExpr.EDITOR + ")")
    public ResponseEntity<Void> deleteReference(
            @PathVariable String projectKey, @PathVariable UUID uuid, @RequestParam(defaultValue = "false") boolean force) {
        pageReferenceService.find(projectId(projectKey), uuid); // 404s / 422s if uuid isn't a live PageReference
        assetService.softDelete(uuid, force, ctx(projectKey, "delete page reference"));
        return ResponseEntity.noContent().build();
    }

    /** The page a {@code PageReference} currently resolves to, plus its canonical path, for the UI's live preview. */
    @GetMapping("/references/{uuid}/resolve")
    @PreAuthorize("@projectAuth.has(#projectKey, " + ProjectRoleExpr.VIEWER + ")")
    public PageReferenceResolveView resolve(@PathVariable String projectKey, @PathVariable UUID uuid) {
        long projectId = projectId(projectKey);
        pageReferenceService.find(projectId, uuid); // 404s if uuid isn't a live PageReference
        UUID pageUuid = navigationService.resolve(projectId, uuid, navigationLookup);
        if (pageUuid == null) {
            return new PageReferenceResolveView(null, null);
        }
        AssetVersionView page = assetService.requireCurrent(projectId(projectKey), pageUuid);
        return new PageReferenceResolveView(page.uuid(), page.folderPath());
    }

    /**
     * Every top-level `NAVIGATION` item's uuid — today, always exactly the fixed "All
     * Navigation" root folder (every top-level nav folder/reference nests under it, so nothing
     * else is ever a direct child of the hidden project root for this scope).
     */
    private List<UUID> topLevelNavigationUuids(String projectKey) {
        return folderService.tree(projectId(projectKey), FolderScope.NAVIGATION, 0, ctx(projectKey, null))
                .stream()
                .map(FolderNode::uuid)
                .toList();
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
        return new NavigationFolderView(
                v.uuid(), v.uid(), v.displayName(), v.validFromRevision(), v.folderPath(),
                FolderScope.isProtected(v.payload()), startNodeView);
    }



    /** {@code chain} resolves a language-dependent label; an empty chain takes it as stored (M24.2.2). */
    private static PageReferenceView toReferenceView(
            AssetVersionView v,
            List<String> chain,
            java.util.Map<String, com.acme.staticforge.api.dto.LocaleReleaseView> release,
            List<ScheduledRefView> scheduled) {
        JsonNode payload = v.payload();
        String targetKind = payload.path("target").path("kind").asText(null);
        String targetUuidText = payload.path("target").path("assetUuid").asText(null);
        UUID targetUuid = targetUuidText == null ? null : UUID.fromString(targetUuidText);
        JsonNode stored = payload.get("label");
        String label;
        java.util.Map<String, String> labelL10n = null;
        if (com.acme.staticforge.common.L10nValues.isL10n(stored)) {
            List<String> lookup = chain.isEmpty() ? com.acme.staticforge.common.L10nValues.locales(stored) : chain;
            JsonNode resolved = com.acme.staticforge.common.L10nValues.resolve(stored, lookup);
            label = resolved == null ? null : resolved.asText();
            labelL10n = new java.util.LinkedHashMap<>();
            for (String locale : com.acme.staticforge.common.L10nValues.locales(stored)) {
                labelL10n.put(locale, com.acme.staticforge.common.L10nValues.get(stored, locale).asText());
            }
        } else {
            label = stored == null || stored.isNull() ? null : stored.asText();
        }
        return new PageReferenceView(
                v.uuid(), v.uid(), v.displayName(), v.validFromRevision(), v.folderPath(), targetKind, targetUuid,
                label, labelL10n, release, scheduled);
    }
}
