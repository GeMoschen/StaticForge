package com.acme.staticforge.api;

import com.acme.staticforge.api.dto.CreateDatasetRequest;
import com.acme.staticforge.api.dto.DatasetDetailView;
import com.acme.staticforge.api.dto.DatasetSummaryView;
import com.acme.staticforge.api.dto.RestoreRequest;
import com.acme.staticforge.api.dto.UpdateDatasetRequest;
import com.acme.staticforge.asset.AssetService;
import com.acme.staticforge.asset.dataset.CreateDatasetCommand;
import com.acme.staticforge.asset.dataset.DatasetService;
import com.acme.staticforge.asset.dataset.DatasetView;
import com.acme.staticforge.asset.dataset.UpdateDatasetCommand;
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
 * Dataset schema endpoints (M19.2.1, spec §20.2). Schemas are developer-owned: every write is
 * {@code DEVELOPER}, reads are {@code VIEWER}. Records have their own controller
 * ({@link RecordController}) with {@code EDITOR} writes.
 *
 * <p>Generic operations stay generic: subfolders use {@link FolderController} with
 * {@code scope=TEMPLATES, templateKind=DATASET}; moving a dataset, changing its uid, usages and
 * history use {@link AssetController}.
 */
@RestController
@RequestMapping("/api/v1/projects/{projectKey}/datasets")
public class DatasetController {

    private final ProjectService projectService;
    private final DatasetService datasetService;
    private final AssetService assetService;
    private final SecuritySupport securitySupport;

    public DatasetController(
            ProjectService projectService,
            DatasetService datasetService,
            AssetService assetService,
            SecuritySupport securitySupport) {
        this.projectService = projectService;
        this.datasetService = datasetService;
        this.assetService = assetService;
        this.securitySupport = securitySupport;
    }

    @GetMapping
    @PreAuthorize("@projectAuth.has(#projectKey, " + ProjectRoleExpr.VIEWER + ")")
    public List<DatasetSummaryView> list(@PathVariable String projectKey) {
        return datasetService.list(projectId(projectKey)).stream()
                .map(v -> new DatasetSummaryView(
                        v.uuid(), v.uid(), v.displayName(), v.folderUuid(), v.folderPath(), v.titleEditor(),
                        v.description(), v.recordCount(), v.revision()))
                .toList();
    }

    @GetMapping("/{uuid}")
    @PreAuthorize("@projectAuth.has(#projectKey, " + ProjectRoleExpr.VIEWER + ")")
    public ResponseEntity<DatasetDetailView> detail(
            @PathVariable String projectKey,
            @PathVariable UUID uuid,
            @RequestParam(value = "revision", required = false) Long revision) {
        return ok(require(projectId(projectKey), uuid, revision));
    }

    @PostMapping
    @PreAuthorize("@projectAuth.has(#projectKey, " + ProjectRoleExpr.DEVELOPER + ")")
    public ResponseEntity<DatasetDetailView> create(
            @PathVariable String projectKey, @RequestBody CreateDatasetRequest body) {
        DatasetView view = datasetService.create(
                new CreateDatasetCommand(
                        projectId(projectKey),
                        body.parentFolderUuid(),
                        body.displayName(),
                        body.contentDefinition(),
                        body.titleEditor(),
                        body.description()),
                ctx(projectKey, comment(body.comment(), "create dataset")));
        return ResponseEntity.status(201)
                .header(HttpHeaders.ETAG, RevisionHeaders.etag(view.revision()))
                .body(toDetail(view));
    }

    @PutMapping("/{uuid}")
    @PreAuthorize("@projectAuth.has(#projectKey, " + ProjectRoleExpr.DEVELOPER + ")")
    public ResponseEntity<DatasetDetailView> update(
            @PathVariable String projectKey,
            @PathVariable UUID uuid,
            @RequestHeader(value = "If-Match", required = false) String ifMatch,
            @RequestParam(value = "confirmDiscard", defaultValue = "false") boolean confirmDiscard,
            @RequestBody UpdateDatasetRequest body) {
        long expected = RevisionHeaders.expectedRevision(ifMatch);
        DatasetView view = datasetService.update(
                uuid,
                new UpdateDatasetCommand(body.displayName(), body.contentDefinition(), body.titleEditor(), body.description()),
                expected,
                confirmDiscard,
                ctx(projectKey, comment(body.comment(), "update dataset schema")));
        return ok(view);
    }

    /** {@code 409 SF-DOM-0121} with {@code recordCount}/{@code setCount} while the dataset has live records or sets. */
    @DeleteMapping("/{uuid}")
    @PreAuthorize("@projectAuth.has(#projectKey, " + ProjectRoleExpr.DEVELOPER + ")")
    public ResponseEntity<Void> delete(@PathVariable String projectKey, @PathVariable UUID uuid) {
        require(projectId(projectKey), uuid, null);
        datasetService.delete(uuid, ctx(projectKey, "delete dataset"));
        return ResponseEntity.noContent().build();
    }

    /** Restores the dataset to its state at {@code fromRevision} (for a deleted one: its last live revision). */
    @PostMapping("/{uuid}/restore")
    @PreAuthorize("@projectAuth.has(#projectKey, " + ProjectRoleExpr.DEVELOPER + ")")
    public ResponseEntity<DatasetDetailView> restore(
            @PathVariable String projectKey, @PathVariable UUID uuid, @RequestBody RestoreRequest body) {
        long projectId = projectId(projectKey);
        require(projectId, uuid, null);
        assetService.restore(uuid, body.fromRevision(), ctx(projectKey, "restore dataset"));
        return ok(require(projectId, uuid, null));
    }

    private DatasetView require(long projectId, UUID uuid, Long revision) {
        return datasetService.find(projectId, uuid, revision)
                .orElseThrow(() -> new SfException(ProblemFactory.notFound("Dataset not found.")));
    }

    private static ResponseEntity<DatasetDetailView> ok(DatasetView view) {
        return ResponseEntity.ok()
                .header(HttpHeaders.ETAG, RevisionHeaders.etag(view.revision()))
                .body(toDetail(view));
    }

    private static DatasetDetailView toDetail(DatasetView v) {
        return new DatasetDetailView(
                v.uuid(),
                v.uid(),
                v.displayName(),
                v.folderUuid(),
                v.folderPath(),
                v.contentDefinition(),
                v.compiledDefinition(),
                v.titleEditor(),
                v.description(),
                v.recordCount(),
                v.revision(),
                v.deleted());
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
