package com.acme.staticforge.api;

import com.acme.staticforge.api.dto.AssetRefView;
import com.acme.staticforge.api.dto.CreateRecordSetRequest;
import com.acme.staticforge.api.dto.RecordPageView;
import com.acme.staticforge.api.dto.RecordSetDetailView;
import com.acme.staticforge.api.dto.RecordSetQueryPreviewView;
import com.acme.staticforge.api.dto.RecordSetSummaryView;
import com.acme.staticforge.api.dto.UpdateRecordSetRequest;
import com.acme.staticforge.asset.dataset.CreateRecordSetCommand;
import com.acme.staticforge.asset.dataset.RecordService.RecordListQuery;
import com.acme.staticforge.asset.dataset.RecordSetQueryPreview;
import com.acme.staticforge.asset.dataset.RecordSetService;
import com.acme.staticforge.asset.dataset.RecordSetView;
import com.acme.staticforge.asset.dataset.UpdateRecordSetCommand;
import com.acme.staticforge.common.ProblemFactory;
import com.acme.staticforge.common.SfException;
import com.acme.staticforge.project.ProjectService;
import com.acme.staticforge.revision.RevisionContext;
import com.acme.staticforge.security.SecuritySupport;
import com.acme.staticforge.template.query.RecordSetQuery;
import jakarta.servlet.http.HttpServletRequest;
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
 * Record set endpoints (M25.3.1, spec §20.2). Record sets and their stored queries are editor content:
 * {@code EDITOR} writes, {@code VIEWER} reads, {@code ETag} = revision, {@code If-Match} on update and
 * {@code ?revision=} for time travel — the {@link DatasetController}/{@link RecordController} protocol.
 *
 * <p>A stored query that does not validate against the dataset schema is {@code 422 SF-API-0422} with
 * {@code diagnostics} ({@code SF-TPL-0140..0142}, each naming its query part and position);
 * {@code POST /{uuid}/preview-query} runs the same check on a draft without saving it. Deleting a set with
 * live records is {@code 409 SF-DOM-0110} with {@code recordCount} unless {@code cascade=true}.
 *
 * <p>The set grid ({@code GET /{uuid}/records}) takes the dataset listing's {@code q}, {@code where} and
 * {@code sort} with the same parsers; with {@code applySetQuery=true} the stored query runs first and the
 * request narrows it (epic decision 5). Records are added through
 * {@code POST /datasets/{uuid}/records} with {@code recordSetUuid}.
 *
 * <p>Move, uid change, display-name change, generic delete, restore, usages and history are the
 * {@link AssetController} endpoints; the containment rules hold there too ({@code 422 SF-DOM-0104}).
 */
@RestController
@RequestMapping("/api/v1/projects/{projectKey}/record-sets")
public class RecordSetController {

    private final ProjectService projectService;
    private final RecordSetService recordSetService;
    private final SecuritySupport securitySupport;
    private final ReleaseBlocks releaseBlocks;

    private final CompactedReads compactedReads;

    public RecordSetController(
            ProjectService projectService,
            RecordSetService recordSetService,
            SecuritySupport securitySupport,
            ReleaseBlocks releaseBlocks,
            CompactedReads compactedReads) {
        this.compactedReads = compactedReads;
        this.releaseBlocks = releaseBlocks;
        this.projectService = projectService;
        this.recordSetService = recordSetService;
        this.securitySupport = securitySupport;
    }

    /** The project's live record sets — of one dataset when {@code dataset} is given — by display name. */
    @GetMapping
    @PreAuthorize("@projectAuth.has(#projectKey, " + ProjectRoleExpr.VIEWER + ")")
    public List<RecordSetSummaryView> list(
            @PathVariable String projectKey, @RequestParam(value = "dataset", required = false) UUID dataset) {
        long projectId = projectId(projectKey);
        var sets = recordSetService.list(projectId, dataset);
        List<UUID> uuids = sets.stream().map(v -> v.uuid()).toList();
        var release = releaseBlocks.of(projectId, uuids);
        var scheduled = releaseBlocks.scheduled(projectId, uuids);
        return sets.stream()
                .map(v -> new RecordSetSummaryView(
                        v.uuid(), v.uid(), v.displayName(), datasetRef(v), v.folderUuid(), v.folderPath(),
                        v.recordCount(), v.queryValid(), v.revision(), v.changedAt(), release.get(v.uuid()),
                        scheduled.getOrDefault(v.uuid(), List.of())))
                .toList();
    }

    @GetMapping("/{uuid}")
    @PreAuthorize("@projectAuth.has(#projectKey, " + ProjectRoleExpr.VIEWER + ")")
    public ResponseEntity<RecordSetDetailView> detail(
            @PathVariable String projectKey,
            @PathVariable UUID uuid,
            @RequestParam(value = "revision", required = false) Long revision) {
        long projectId = projectId(projectKey);
        return compactedReads.mark(ok(projectKey, require(projectId, uuid, revision)), projectId, uuid, revision);
    }

    /** {@code 400} naming {@code datasetUuid} without one; {@code 422} with {@code diagnostics} for a bad query. */
    @PostMapping
    @PreAuthorize("@projectAuth.has(#projectKey, " + ProjectRoleExpr.EDITOR + ")")
    public ResponseEntity<RecordSetDetailView> create(
            @PathVariable String projectKey, @RequestBody CreateRecordSetRequest body) {
        if (body.datasetUuid() == null) {
            throw new SfException(ProblemFactory.badRequest(
                    "datasetUuid is required: a record set holds the records of one dataset.", "datasetUuid"));
        }
        RecordSetView view = recordSetService.create(
                new CreateRecordSetCommand(
                        projectId(projectKey),
                        body.folderUuid(),
                        body.datasetUuid(),
                        body.uid(),
                        body.displayName(),
                        body.query()),
                ctx(projectKey, comment(body.comment(), "create record set")));
        return ResponseEntity.status(201)
                .header(HttpHeaders.ETAG, RevisionHeaders.etag(view.revision()))
                .body(toDetail(projectKey, view));
    }

    /** Renames the set and replaces its query; {@code 422} with {@code diagnostics} for an invalid query. */
    @PutMapping("/{uuid}")
    @PreAuthorize("@projectAuth.has(#projectKey, " + ProjectRoleExpr.EDITOR + ")")
    public ResponseEntity<RecordSetDetailView> update(
            @PathVariable String projectKey,
            @PathVariable UUID uuid,
            @RequestHeader(value = "If-Match", required = false) String ifMatch,
            @RequestBody UpdateRecordSetRequest body) {
        long expected = RevisionHeaders.expectedRevision(ifMatch);
        RecordSetView view = recordSetService.update(
                uuid,
                new UpdateRecordSetCommand(body.displayName(), body.query()),
                expected,
                ctx(projectKey, comment(body.comment(), "update record set")));
        return ok(projectKey, view);
    }

    /** {@code 409 SF-DOM-0110} with {@code recordCount} while the set has live records, unless {@code cascade}. */
    @DeleteMapping("/{uuid}")
    @PreAuthorize("@projectAuth.has(#projectKey, " + ProjectRoleExpr.EDITOR + ")")
    public ResponseEntity<Void> delete(
            @PathVariable String projectKey,
            @PathVariable UUID uuid,
            @RequestParam(value = "cascade", defaultValue = "false") boolean cascade) {
        recordSetService.delete(uuid, cascade, ctx(projectKey, cascade ? "delete record set with records" : "delete record set"));
        return ResponseEntity.noContent().build();
    }

    /**
     * One page of the set's live records. {@code applySetQuery=true}: the stored query first, then the
     * request's {@code where} (AND-ed), {@code sort} (re-sorts; without one the set's order is kept) and
     * {@code q}; a set whose stored query no longer validates lists nothing. Otherwise every record of the set,
     * filtered and ordered like the dataset listing. {@code locale} picks the language language-dependent
     * values compare in (default: the project's default language). Every row carries {@code selectedBySet}:
     * whether the stored query selects it ({@code false} for all while the query is invalid), so "All records"
     * can mark what the set leaves out. {@code revision} lists the set as of that revision (membership, values,
     * stored query and schema; {@code 404} before the set existed or while it was deleted).
     */
    @GetMapping("/{uuid}/records")
    @PreAuthorize("@projectAuth.has(#projectKey, " + ProjectRoleExpr.VIEWER + ")")
    public ResponseEntity<RecordPageView> records(
            @PathVariable String projectKey,
            @PathVariable UUID uuid,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "50") int size,
            @RequestParam(value = "sort", required = false) List<String> sort,
            @RequestParam(value = "q", required = false) String q,
            @RequestParam(value = "where", required = false) String where,
            @RequestParam(value = "applySetQuery", defaultValue = "false") boolean applySetQuery,
            @RequestParam(value = "locale", required = false) String locale,
            @RequestParam(value = "revision", required = false) Long revision,
            HttpServletRequest request) {
        long projectId = projectId(projectKey);
        RecordPageView view = RecordController.toPageView(recordSetService.listRecords(
                projectId,
                uuid,
                new RecordListQuery(q, null, where, RecordController.sortKeys(request)),
                applySetQuery,
                locale,
                revision,
                page,
                size), releaseBlocks, projectId);
        // X-SF-Compacted (M29.4.3) when the set or any listed record shows compacted history at the revision.
        java.util.List<UUID> shown = new java.util.ArrayList<>(view.content().stream().map(r -> r.uuid()).toList());
        shown.add(uuid);
        return compactedReads.markAny(ResponseEntity.ok(view), projectId, shown, revision);
    }

    /**
     * Checks a draft query against the set's dataset without saving: diagnostics and match counts. Tooling for
     * the query editor, so {@code EDITOR} like the validate endpoints of the other stores' owners.
     */
    @AllowedOnArchivedProject("Evaluates a draft query, stores nothing.")
    @PostMapping("/{uuid}/preview-query")
    @PreAuthorize("@projectAuth.has(#projectKey, " + ProjectRoleExpr.EDITOR + ")")
    public RecordSetQueryPreviewView previewQuery(
            @PathVariable String projectKey, @PathVariable UUID uuid, @RequestBody(required = false) RecordSetQuery draft) {
        RecordSetQueryPreview preview = recordSetService.previewQuery(projectId(projectKey), uuid, draft);
        return new RecordSetQueryPreviewView(
                preview.valid(), preview.diagnostics(), preview.matchCount(), preview.selectedCount());
    }

    private RecordSetView require(long projectId, UUID uuid, Long revision) {
        return recordSetService.find(projectId, uuid, revision)
                .orElseThrow(() -> new SfException(ProblemFactory.notFound("Record set not found.")));
    }

    private ResponseEntity<RecordSetDetailView> ok(String projectKey, RecordSetView view) {
        return ResponseEntity.ok()
                .header(HttpHeaders.ETAG, RevisionHeaders.etag(view.revision()))
                .body(toDetail(projectKey, view));
    }

    private RecordSetDetailView toDetail(String projectKey, RecordSetView v) {
        return new RecordSetDetailView(
                v.uuid(),
                v.uid(),
                v.displayName(),
                datasetRef(v),
                v.folderUuid(),
                v.folderPath(),
                v.query(),
                v.queryValid(),
                v.queryDiagnostics(),
                v.recordCount(),
                v.revision(),
                v.changedBy(),
                v.changedAt(),
                v.deleted(),
                releaseBlocks.of(projectId(projectKey), v.uuid()),
                releaseBlocks.scheduled(projectId(projectKey), v.uuid()));
    }

    private static AssetRefView datasetRef(RecordSetView v) {
        return new AssetRefView(v.datasetUuid(), v.datasetUid(), v.datasetDisplayName());
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
