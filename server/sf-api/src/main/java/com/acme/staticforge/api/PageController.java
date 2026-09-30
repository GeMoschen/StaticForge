package com.acme.staticforge.api;

import com.acme.staticforge.api.dto.AddSectionRequest;
import com.acme.staticforge.api.dto.AssetSummaryView;
import com.acme.staticforge.api.dto.CreatePageRequest;
import com.acme.staticforge.api.dto.MoveSectionRequest;
import com.acme.staticforge.api.dto.PageView;
import com.acme.staticforge.api.dto.ReorderRequest;
import com.acme.staticforge.api.dto.ScheduledRefView;
import com.acme.staticforge.api.dto.TemplateView;
import com.acme.staticforge.asset.AssetVersionView;
import com.acme.staticforge.asset.content.ContentIssue;
import com.acme.staticforge.asset.page.CreatePageCommand;
import com.acme.staticforge.asset.page.PageQuery;
import com.acme.staticforge.asset.page.PageService;
import com.acme.staticforge.asset.page.TemplateRefView;
import com.acme.staticforge.asset.rules.SaveFindings;
import com.acme.staticforge.project.ProjectService;
import com.acme.staticforge.revision.RevisionContext;
import com.acme.staticforge.security.SecuritySupport;
import com.fasterxml.jackson.databind.JsonNode;
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
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/** Page endpoints (spec §20.2). */
@RestController
@RequestMapping("/api/v1/projects/{projectKey}/pages")
public class PageController {

    private final ProjectService projectService;
    private final PageService pageService;
    private final SecuritySupport securitySupport;
    private final ReleaseBlocks releaseBlocks;

    public PageController(
            ProjectService projectService,
            PageService pageService,
            SecuritySupport securitySupport,
            ReleaseBlocks releaseBlocks) {
        this.projectService = projectService;
        this.pageService = pageService;
        this.securitySupport = securitySupport;
        this.releaseBlocks = releaseBlocks;
    }

    @GetMapping
    @PreAuthorize("@projectAuth.has(#projectKey, " + ProjectRoleExpr.VIEWER + ")")
    public List<AssetSummaryView> list(
            @PathVariable String projectKey,
            @RequestParam(required = false) UUID folder,
            @RequestParam(required = false) UUID templateUuid,
            @RequestParam(required = false) String q) {
        long projectId = projectId(projectKey);
        List<AssetVersionView> pages = pageService.list(projectId, new PageQuery(folder, templateUuid, q));
        List<UUID> uuids = pages.stream().map(AssetVersionView::uuid).toList();
        var release = releaseBlocks.of(projectId, uuids);
        var scheduled = releaseBlocks.scheduled(projectId, uuids);
        return pages.stream()
                .map(v -> toSummary(v, release.get(v.uuid()), scheduled.getOrDefault(v.uuid(), List.of())))
                .toList();
    }

    @PostMapping
    @PreAuthorize("@projectAuth.has(#projectKey, " + ProjectRoleExpr.EDITOR + ")")
    public ResponseEntity<PageView> create(@PathVariable String projectKey, @RequestBody CreatePageRequest body) {
        SaveFindings.Captured<AssetVersionView> saved = SaveFindings.capture(() -> pageService.create(
                new CreatePageCommand(body.displayName(), body.folderUuid(), body.templateUuid()), ctx(projectKey, "create page")));
        AssetVersionView view = saved.value();
        return ResponseEntity.ok().header(HttpHeaders.ETAG, RevisionHeaders.etag(view.validFromRevision())).body(toPage(projectId(projectKey), view, saved.findings()));
    }

    @GetMapping("/{uuid}")
    @PreAuthorize("@projectAuth.has(#projectKey, " + ProjectRoleExpr.VIEWER + ")")
    public ResponseEntity<PageView> detail(@PathVariable String projectKey, @PathVariable UUID uuid) {
        AssetVersionView view = pageService.find(projectId(projectKey), uuid);
        return ResponseEntity.ok().header(HttpHeaders.ETAG, RevisionHeaders.etag(view.validFromRevision())).body(toPage(projectId(projectKey), view));
    }

    @PutMapping("/{uuid}")
    @PreAuthorize("@projectAuth.has(#projectKey, " + ProjectRoleExpr.EDITOR + ")")
    public ResponseEntity<PageView> update(
            @PathVariable String projectKey,
            @PathVariable UUID uuid,
            @RequestHeader(value = "If-Match", required = false) String ifMatch,
            @RequestBody JsonNode payload) {
        SaveFindings.Captured<AssetVersionView> saved = SaveFindings.capture(() -> pageService.update(uuid, payload, RevisionHeaders.expectedRevision(ifMatch), ctx(projectKey, "update page")));
        AssetVersionView view = saved.value();
        return ResponseEntity.ok().header(HttpHeaders.ETAG, RevisionHeaders.etag(view.validFromRevision())).body(toPage(projectId(projectKey), view, saved.findings()));
    }

    @PatchMapping("/{uuid}/content")
    @PreAuthorize("@projectAuth.has(#projectKey, " + ProjectRoleExpr.EDITOR + ")")
    public ResponseEntity<PageView> patchContent(
            @PathVariable String projectKey,
            @PathVariable UUID uuid,
            @RequestHeader(value = "If-Match", required = false) String ifMatch,
            @RequestBody JsonNode patch) {
        SaveFindings.Captured<AssetVersionView> saved = SaveFindings.capture(() -> pageService.patchContent(uuid, patch, RevisionHeaders.expectedRevision(ifMatch), ctx(projectKey, "patch content")));
        AssetVersionView view = saved.value();
        return ResponseEntity.ok().header(HttpHeaders.ETAG, RevisionHeaders.etag(view.validFromRevision())).body(toPage(projectId(projectKey), view, saved.findings()));
    }

    @PostMapping("/{uuid}/bodies/{body}/sections")
    @PreAuthorize("@projectAuth.has(#projectKey, " + ProjectRoleExpr.EDITOR + ")")
    public ResponseEntity<PageView> addSection(
            @PathVariable String projectKey,
            @PathVariable UUID uuid,
            @PathVariable String body,
            @RequestHeader(value = "If-Match", required = false) String ifMatch,
            @RequestBody AddSectionRequest request) {
        SaveFindings.Captured<AssetVersionView> saved = SaveFindings.capture(() -> pageService.addSection(
                uuid, body, request.templateUuid(), request.position(), RevisionHeaders.expectedRevision(ifMatch), ctx(projectKey, "add section")));
        AssetVersionView view = saved.value();
        return ResponseEntity.ok().header(HttpHeaders.ETAG, RevisionHeaders.etag(view.validFromRevision())).body(toPage(projectId(projectKey), view, saved.findings()));
    }

    @PutMapping("/{uuid}/bodies/{body}/order")
    @PreAuthorize("@projectAuth.has(#projectKey, " + ProjectRoleExpr.EDITOR + ")")
    public ResponseEntity<PageView> reorder(
            @PathVariable String projectKey,
            @PathVariable UUID uuid,
            @PathVariable String body,
            @RequestHeader(value = "If-Match", required = false) String ifMatch,
            @RequestBody ReorderRequest request) {
        SaveFindings.Captured<AssetVersionView> saved = SaveFindings.capture(() -> pageService.reorderSections(
                uuid, body, request.instanceIds(), RevisionHeaders.expectedRevision(ifMatch), ctx(projectKey, "reorder sections")));
        AssetVersionView view = saved.value();
        return ResponseEntity.ok().header(HttpHeaders.ETAG, RevisionHeaders.etag(view.validFromRevision())).body(toPage(projectId(projectKey), view, saved.findings()));
    }

    @PostMapping("/{uuid}/bodies/{body}/sections/move")
    @PreAuthorize("@projectAuth.has(#projectKey, " + ProjectRoleExpr.EDITOR + ")")
    public ResponseEntity<PageView> moveSection(
            @PathVariable String projectKey,
            @PathVariable UUID uuid,
            @PathVariable String body,
            @RequestHeader(value = "If-Match", required = false) String ifMatch,
            @RequestBody MoveSectionRequest request) {
        SaveFindings.Captured<AssetVersionView> saved = SaveFindings.capture(() -> pageService.moveSection(
                request.sourcePageUuid(),
                request.sourceBody(),
                request.instanceId(),
                uuid,
                body,
                request.position(),
                RevisionHeaders.expectedRevision(ifMatch),
                ctx(projectKey, "move section")));
        AssetVersionView view = saved.value();
        return ResponseEntity.ok().header(HttpHeaders.ETAG, RevisionHeaders.etag(view.validFromRevision())).body(toPage(projectId(projectKey), view, saved.findings()));
    }

    @DeleteMapping("/{uuid}/bodies/{body}/sections/{instanceId}")
    @PreAuthorize("@projectAuth.has(#projectKey, " + ProjectRoleExpr.EDITOR + ")")
    public ResponseEntity<PageView> deleteSection(
            @PathVariable String projectKey,
            @PathVariable UUID uuid,
            @PathVariable String body,
            @PathVariable String instanceId,
            @RequestHeader(value = "If-Match", required = false) String ifMatch) {
        SaveFindings.Captured<AssetVersionView> saved = SaveFindings.capture(() -> pageService.deleteSection(
                uuid, body, instanceId, RevisionHeaders.expectedRevision(ifMatch), ctx(projectKey, "delete section")));
        AssetVersionView view = saved.value();
        return ResponseEntity.ok().header(HttpHeaders.ETAG, RevisionHeaders.etag(view.validFromRevision())).body(toPage(projectId(projectKey), view, saved.findings()));
    }

    @PostMapping("/{uuid}/duplicate")
    @PreAuthorize("@projectAuth.has(#projectKey, " + ProjectRoleExpr.EDITOR + ")")
    public ResponseEntity<PageView> duplicate(@PathVariable String projectKey, @PathVariable UUID uuid) {
        AssetVersionView view = pageService.duplicate(uuid, ctx(projectKey, "duplicate page"));
        return ResponseEntity.ok().header(HttpHeaders.ETAG, RevisionHeaders.etag(view.validFromRevision())).body(toPage(projectId(projectKey), view));
    }

    private long projectId(String key) {
        return projectService.requireByKey(key).getId();
    }

    private RevisionContext ctx(String key, String comment) {
        return RevisionContext.of(projectId(key), securitySupport.currentUserId(), comment);
    }

    private PageView toPage(long projectId, AssetVersionView v) {
        return toPage(projectId, v, List.of());
    }

    /**
     * The page view; {@code saveFindings} are what the save rule gate reported (M33.4) — its {@code read-only} notes
     * join the {@code edit} outcome of the stored draft.
     */
    private PageView toPage(long projectId, AssetVersionView v, List<ContentIssue> saveFindings) {
        JsonNode payload = v.payload();
        String templateRef = payload != null ? payload.path("templateRef").asText() : "";
        TemplateView template = null;
        if (!templateRef.isBlank()) {
            TemplateRefView t = pageService.resolveTemplate(projectId, UUID.fromString(templateRef));
            template = new TemplateView(t.uuid(), t.uid(), t.displayName());
        }
        return new PageView(
                v.uuid(), v.uid(), v.displayName(), v.validFromRevision(), v.folderPath(), template,
                payload != null ? payload.get("content") : null,
                payload != null ? payload.get("bodies") : null,
                payload != null ? payload.get("nav") : null,
                payload != null ? payload.get("output") : null,
                payload != null ? payload.get("meta") : null,
                SaveIssues.merge(saveFindings, pageService.contentIssues(projectId, v.uuid(), payload)),
                releaseBlocks.of(projectId, v.uuid()),
                releaseBlocks.scheduled(projectId, v.uuid()));
    }

    private static AssetSummaryView toSummary(
            AssetVersionView v,
            java.util.Map<String, com.acme.staticforge.api.dto.LocaleReleaseView> release,
            List<ScheduledRefView> scheduled) {
        return new AssetSummaryView(
                v.uuid(), v.uid(), v.type().name(), v.displayName(), v.folderPath(), v.validFromRevision(), release, scheduled);
    }
}
