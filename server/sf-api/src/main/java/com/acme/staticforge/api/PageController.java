package com.acme.staticforge.api;

import com.acme.staticforge.api.dto.AddSectionRequest;
import com.acme.staticforge.api.dto.AssetSummaryView;
import com.acme.staticforge.api.dto.CreatePageRequest;
import com.acme.staticforge.api.dto.MoveSectionRequest;
import com.acme.staticforge.api.dto.PageView;
import com.acme.staticforge.api.dto.ReorderRequest;
import com.acme.staticforge.api.dto.TemplateView;
import com.acme.staticforge.asset.AssetVersionView;
import com.acme.staticforge.asset.page.CreatePageCommand;
import com.acme.staticforge.asset.page.PageQuery;
import com.acme.staticforge.asset.page.PageService;
import com.acme.staticforge.asset.page.TemplateRefView;
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

    public PageController(ProjectService projectService, PageService pageService, SecuritySupport securitySupport) {
        this.projectService = projectService;
        this.pageService = pageService;
        this.securitySupport = securitySupport;
    }

    @GetMapping
    @PreAuthorize("@projectAuth.has(#projectKey, " + ProjectRoleExpr.VIEWER + ")")
    public List<AssetSummaryView> list(
            @PathVariable String projectKey,
            @RequestParam(required = false) UUID folder,
            @RequestParam(required = false) UUID templateUuid,
            @RequestParam(required = false) String q) {
        List<AssetVersionView> pages = pageService.list(projectId(projectKey), new PageQuery(folder, templateUuid, q));
        return pages.stream().map(PageController::toSummary).toList();
    }

    @PostMapping
    @PreAuthorize("@projectAuth.has(#projectKey, " + ProjectRoleExpr.EDITOR + ")")
    public ResponseEntity<PageView> create(@PathVariable String projectKey, @RequestBody CreatePageRequest body) {
        AssetVersionView view = pageService.create(
                new CreatePageCommand(body.displayName(), body.folderUuid(), body.templateUuid()), ctx(projectKey, "create page"));
        return ResponseEntity.ok().header(HttpHeaders.ETAG, RevisionHeaders.etag(view.validFromRevision())).body(toPage(projectId(projectKey), view));
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
        AssetVersionView view = pageService.update(uuid, payload, RevisionHeaders.expectedRevision(ifMatch), ctx(projectKey, "update page"));
        return ResponseEntity.ok().header(HttpHeaders.ETAG, RevisionHeaders.etag(view.validFromRevision())).body(toPage(projectId(projectKey), view));
    }

    @PatchMapping("/{uuid}/content")
    @PreAuthorize("@projectAuth.has(#projectKey, " + ProjectRoleExpr.EDITOR + ")")
    public ResponseEntity<PageView> patchContent(
            @PathVariable String projectKey,
            @PathVariable UUID uuid,
            @RequestHeader(value = "If-Match", required = false) String ifMatch,
            @RequestBody JsonNode patch) {
        AssetVersionView view = pageService.patchContent(uuid, patch, RevisionHeaders.expectedRevision(ifMatch), ctx(projectKey, "patch content"));
        return ResponseEntity.ok().header(HttpHeaders.ETAG, RevisionHeaders.etag(view.validFromRevision())).body(toPage(projectId(projectKey), view));
    }

    @PostMapping("/{uuid}/bodies/{body}/sections")
    @PreAuthorize("@projectAuth.has(#projectKey, " + ProjectRoleExpr.EDITOR + ")")
    public ResponseEntity<PageView> addSection(
            @PathVariable String projectKey,
            @PathVariable UUID uuid,
            @PathVariable String body,
            @RequestHeader(value = "If-Match", required = false) String ifMatch,
            @RequestBody AddSectionRequest request) {
        AssetVersionView view = pageService.addSection(
                uuid, body, request.templateUuid(), request.position(), RevisionHeaders.expectedRevision(ifMatch), ctx(projectKey, "add section"));
        return ResponseEntity.ok().header(HttpHeaders.ETAG, RevisionHeaders.etag(view.validFromRevision())).body(toPage(projectId(projectKey), view));
    }

    @PutMapping("/{uuid}/bodies/{body}/order")
    @PreAuthorize("@projectAuth.has(#projectKey, " + ProjectRoleExpr.EDITOR + ")")
    public ResponseEntity<PageView> reorder(
            @PathVariable String projectKey,
            @PathVariable UUID uuid,
            @PathVariable String body,
            @RequestHeader(value = "If-Match", required = false) String ifMatch,
            @RequestBody ReorderRequest request) {
        AssetVersionView view = pageService.reorderSections(
                uuid, body, request.instanceIds(), RevisionHeaders.expectedRevision(ifMatch), ctx(projectKey, "reorder sections"));
        return ResponseEntity.ok().header(HttpHeaders.ETAG, RevisionHeaders.etag(view.validFromRevision())).body(toPage(projectId(projectKey), view));
    }

    @PostMapping("/{uuid}/bodies/{body}/sections/move")
    @PreAuthorize("@projectAuth.has(#projectKey, " + ProjectRoleExpr.EDITOR + ")")
    public ResponseEntity<PageView> moveSection(
            @PathVariable String projectKey,
            @PathVariable UUID uuid,
            @PathVariable String body,
            @RequestHeader(value = "If-Match", required = false) String ifMatch,
            @RequestBody MoveSectionRequest request) {
        AssetVersionView view = pageService.moveSection(
                request.sourcePageUuid(),
                request.sourceBody(),
                request.instanceId(),
                uuid,
                body,
                request.position(),
                RevisionHeaders.expectedRevision(ifMatch),
                ctx(projectKey, "move section"));
        return ResponseEntity.ok().header(HttpHeaders.ETAG, RevisionHeaders.etag(view.validFromRevision())).body(toPage(projectId(projectKey), view));
    }

    @DeleteMapping("/{uuid}/bodies/{body}/sections/{instanceId}")
    @PreAuthorize("@projectAuth.has(#projectKey, " + ProjectRoleExpr.EDITOR + ")")
    public ResponseEntity<PageView> deleteSection(
            @PathVariable String projectKey,
            @PathVariable UUID uuid,
            @PathVariable String body,
            @PathVariable String instanceId,
            @RequestHeader(value = "If-Match", required = false) String ifMatch) {
        AssetVersionView view = pageService.deleteSection(
                uuid, body, instanceId, RevisionHeaders.expectedRevision(ifMatch), ctx(projectKey, "delete section"));
        return ResponseEntity.ok().header(HttpHeaders.ETAG, RevisionHeaders.etag(view.validFromRevision())).body(toPage(projectId(projectKey), view));
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
                pageService.contentIssues(projectId, payload));
    }

    private static AssetSummaryView toSummary(AssetVersionView v) {
        return new AssetSummaryView(v.uuid(), v.uid(), v.type().name(), v.displayName(), v.folderPath(), v.validFromRevision());
    }
}
