package com.acme.staticforge.api;

import com.acme.staticforge.api.dto.CreateGlobalSetRequest;
import com.acme.staticforge.api.dto.GlobalSetDetailView;
import com.acme.staticforge.api.dto.GlobalSetSummaryView;
import com.acme.staticforge.api.dto.UpdateGlobalSetContentRequest;
import com.acme.staticforge.api.dto.UpdateGlobalSetSchemaRequest;
import com.acme.staticforge.asset.AssetService;
import com.acme.staticforge.asset.globals.CreateGlobalSetCommand;
import com.acme.staticforge.asset.globals.GlobalSetService;
import com.acme.staticforge.asset.globals.GlobalSetView;
import com.acme.staticforge.common.ProblemFactory;
import com.acme.staticforge.common.SfException;
import com.acme.staticforge.project.ProjectService;
import com.acme.staticforge.revision.RevisionContext;
import com.acme.staticforge.security.SecuritySupport;
import java.util.List;
import java.util.UUID;
import org.springframework.http.HttpHeaders;
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

/**
 * Globals store endpoints (M17.2.1, spec §20.2): the named property sets a project's channel
 * templates read through {@code $CMS_VALUE(CMS_GLOBAL.site.title)$}.
 *
 * <p>Schema and values are separate endpoints on purpose. They carry different permissions —
 * declaring the fields is a {@code DEVELOPER} act, filling them in an {@code EDITOR} one — and a
 * single {@code PUT} accepting both would have to decide the role from which fields changed, a
 * check that drifts the moment the payload grows a field.
 *
 * <p>Everything generic stays where it already is: folders use {@link FolderController} with
 * {@code scope=GLOBALS}, and moving a set, changing its uid, listing its usages, reading its
 * history and restoring it use {@link AssetController}. They are documented in {@code docs/api.md}
 * rather than duplicated here.
 */
@RestController
@RequestMapping("/api/v1/projects/{projectKey}/globals")
public class GlobalsController {

    private final ProjectService projectService;
    private final GlobalSetService globalSetService;
    private final AssetService assetService;
    private final SecuritySupport securitySupport;

    public GlobalsController(
            ProjectService projectService,
            GlobalSetService globalSetService,
            AssetService assetService,
            SecuritySupport securitySupport) {
        this.projectService = projectService;
        this.globalSetService = globalSetService;
        this.assetService = assetService;
        this.securitySupport = securitySupport;
    }

    @GetMapping
    @PreAuthorize("@projectAuth.has(#projectKey, " + ProjectRoleExpr.VIEWER + ")")
    public List<GlobalSetSummaryView> list(
            @PathVariable String projectKey, @RequestParam(value = "folder", required = false) UUID folder) {
        return globalSetService.list(projectId(projectKey), folder).stream()
                .map(v -> new GlobalSetSummaryView(v.uuid(), v.uid(), v.displayName(), v.folderPath(), v.revision()))
                .toList();
    }

    @GetMapping("/{uuid}")
    @PreAuthorize("@projectAuth.has(#projectKey, " + ProjectRoleExpr.VIEWER + ")")
    public ResponseEntity<GlobalSetDetailView> detail(
            @PathVariable String projectKey,
            @PathVariable UUID uuid,
            @RequestParam(value = "revision", required = false) Long revision) {
        GlobalSetView view = globalSetService.find(projectId(projectKey), uuid, revision)
                .orElseThrow(() -> new SfException(ProblemFactory.notFound("Property set not found.")));
        return ok(view);
    }

    @PostMapping
    @PreAuthorize("@projectAuth.has(#projectKey, " + ProjectRoleExpr.DEVELOPER + ")")
    public ResponseEntity<GlobalSetDetailView> create(
            @PathVariable String projectKey, @RequestBody CreateGlobalSetRequest body) {
        GlobalSetView view = globalSetService.create(
                new CreateGlobalSetCommand(
                        projectId(projectKey), body.parentFolderUuid(), body.displayName(), body.contentDefinition()),
                ctx(projectKey, comment(body.comment(), "create property set")));
        return ResponseEntity.status(201)
                .header(HttpHeaders.ETAG, RevisionHeaders.etag(view.revision()))
                .body(toDetail(view));
    }

    @PutMapping("/{uuid}/schema")
    @PreAuthorize("@projectAuth.has(#projectKey, " + ProjectRoleExpr.DEVELOPER + ")")
    public ResponseEntity<GlobalSetDetailView> updateSchema(
            @PathVariable String projectKey,
            @PathVariable UUID uuid,
            @RequestHeader(value = "If-Match", required = false) String ifMatch,
            @RequestParam(value = "confirmDiscard", defaultValue = "false") boolean confirmDiscard,
            @RequestBody UpdateGlobalSetSchemaRequest body) {
        GlobalSetView view = globalSetService.updateSchema(
                uuid,
                body.contentDefinition(),
                RevisionHeaders.expectedRevision(ifMatch),
                confirmDiscard,
                ctx(projectKey, comment(body.comment(), "update property set schema")));
        return ok(view);
    }

    @PutMapping("/{uuid}/content")
    @PreAuthorize("@projectAuth.has(#projectKey, " + ProjectRoleExpr.EDITOR + ")")
    public ResponseEntity<GlobalSetDetailView> updateContent(
            @PathVariable String projectKey,
            @PathVariable UUID uuid,
            @RequestHeader(value = "If-Match", required = false) String ifMatch,
            @RequestBody UpdateGlobalSetContentRequest body) {
        GlobalSetView view = globalSetService.updateValues(
                uuid,
                body.content(),
                RevisionHeaders.expectedRevision(ifMatch),
                ctx(projectKey, comment(body.comment(), "update property set values")));
        return ok(view);
    }

    @DeleteMapping("/{uuid}")
    @PreAuthorize("@projectAuth.has(#projectKey, " + ProjectRoleExpr.DEVELOPER + ")")
    public ResponseEntity<Void> delete(@PathVariable String projectKey, @PathVariable UUID uuid) {
        // Resolving it as a set first turns "wrong type" and "other project" into the same 404
        // the rest of this controller returns, instead of leaking existence through the generic
        // asset path. The soft delete itself stays generic, so the in-use guard (§5.4) applies.
        globalSetService.find(projectId(projectKey), uuid, null)
                .orElseThrow(() -> new SfException(ProblemFactory.notFound("Property set not found.")));
        assetService.softDelete(uuid, false, ctx(projectKey, "delete property set"));
        return ResponseEntity.noContent().build();
    }

    private static ResponseEntity<GlobalSetDetailView> ok(GlobalSetView view) {
        return ResponseEntity.ok()
                .header(HttpHeaders.ETAG, RevisionHeaders.etag(view.revision()))
                .body(toDetail(view));
    }

    private static GlobalSetDetailView toDetail(GlobalSetView v) {
        return new GlobalSetDetailView(
                v.uuid(),
                v.uid(),
                v.displayName(),
                v.folderPath(),
                v.contentDefinition(),
                v.compiledDefinition(),
                v.content(),
                v.revision());
    }

    private static String comment(String supplied, String fallback) {
        return supplied == null || supplied.isBlank() ? fallback : supplied;
    }

    private long projectId(String key) {
        return projectService.requireByKey(key).getId();
    }

    private RevisionContext ctx(String key, String comment) {
        return RevisionContext.of(projectId(key), securitySupport.currentUserId(), comment);
    }
}
