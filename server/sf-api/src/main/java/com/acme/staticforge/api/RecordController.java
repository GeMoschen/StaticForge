package com.acme.staticforge.api;

import com.acme.staticforge.api.dto.AssetRefView;
import com.acme.staticforge.api.dto.CreateRecordRequest;
import com.acme.staticforge.api.dto.RecordDetailView;
import com.acme.staticforge.api.dto.RecordPageView;
import com.acme.staticforge.api.dto.RecordRowView;
import com.acme.staticforge.api.dto.UpdateRecordRequest;
import com.acme.staticforge.asset.content.ContentIssue;
import com.acme.staticforge.asset.dataset.CreateRecordCommand;
import com.acme.staticforge.asset.dataset.RecordDetail;
import com.acme.staticforge.asset.dataset.RecordSetService;
import com.acme.staticforge.asset.folder.RecordSetContainment;
import com.acme.staticforge.asset.dataset.RecordPage;
import com.acme.staticforge.asset.dataset.RecordService.RecordListQuery;
import com.acme.staticforge.asset.dataset.RecordService;
import com.acme.staticforge.asset.dataset.RecordWriteResult;
import com.acme.staticforge.common.ProblemFactory;
import com.acme.staticforge.common.SfException;
import com.acme.staticforge.project.ProjectService;
import com.acme.staticforge.revision.RevisionContext;
import com.acme.staticforge.security.SecuritySupport;
import com.acme.staticforge.template.query.SortKey;
import jakarta.servlet.http.HttpServletRequest;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.UUID;
import org.springframework.http.HttpHeaders;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
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
 * Dataset record endpoints (M19.2.1, spec §20.2): {@code EDITOR} writes, {@code VIEWER} reads.
 *
 * <p>The listing is paged, sortable and filterable on the server, so a grid never downloads a
 * dataset: {@code q} matches display names, {@code folder} is a Content folder prefix
 * ({@code /team/}), {@code where} is an OCTL expression over bare field names
 * ({@code role == 'lead' && joined > '2022-01-01'}) and {@code sort} is repeatable
 * ({@code sort=role,asc&sort=_displayName,desc}). An invalid {@code where} or an unknown or
 * unsortable sort field is a {@code 400} (with {@code column} for a syntax error).
 *
 * <p>{@code GET /datasets/{uuid}/records} lists every record of the dataset across all of its record sets
 * (set queries are not applied — the {@code dataset:} loop view); a set's own grid is
 * {@link RecordSetController}'s {@code GET /record-sets/{uuid}/records}.
 *
 * <p>Delete, restore, move, uid change, usages and history are the generic
 * {@link AssetController} endpoints.
 */
@RestController
@RequestMapping("/api/v1/projects/{projectKey}")
public class RecordController {

    private final ProjectService projectService;
    private final RecordService recordService;
    private final RecordSetService recordSetService;
    private final SecuritySupport securitySupport;

    public RecordController(
            ProjectService projectService,
            RecordService recordService,
            RecordSetService recordSetService,
            SecuritySupport securitySupport) {
        this.projectService = projectService;
        this.recordService = recordService;
        this.recordSetService = recordSetService;
        this.securitySupport = securitySupport;
    }

    @GetMapping("/datasets/{datasetUuid}/records")
    @PreAuthorize("@projectAuth.has(#projectKey, " + ProjectRoleExpr.VIEWER + ")")
    public RecordPageView list(
            @PathVariable String projectKey,
            @PathVariable UUID datasetUuid,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "50") int size,
            @RequestParam(value = "sort", required = false) List<String> sort,
            @RequestParam(value = "q", required = false) String q,
            @RequestParam(value = "where", required = false) String where,
            @RequestParam(value = "folder", required = false) String folder,
            HttpServletRequest request) {
        RecordPage result = recordService.list(
                projectId(projectKey),
                datasetUuid,
                new RecordListQuery(q, folder, where, sortKeys(request)),
                page,
                size);
        return toPageView(result);
    }

    /**
     * Adds a record to the record set {@code recordSetUuid} (M25), which must be a live set of the dataset in
     * the path: a set of another dataset is {@code 422 SF-DOM-0104}. A request without {@code recordSetUuid}
     * (the pre-M25 shape with {@code folderUuid}) is {@code 400} with {@code field: recordSetUuid}.
     */
    @PostMapping("/datasets/{datasetUuid}/records")
    @PreAuthorize("@projectAuth.has(#projectKey, " + ProjectRoleExpr.EDITOR + ")")
    public ResponseEntity<RecordDetailView> create(
            @PathVariable String projectKey, @PathVariable UUID datasetUuid, @RequestBody CreateRecordRequest body) {
        if (body.recordSetUuid() == null) {
            throw new SfException(ProblemFactory.badRequest(
                    "recordSetUuid is required: a record is always created in a record set of its dataset.",
                    "recordSetUuid"));
        }
        long projectId = projectId(projectKey);
        recordSetService.find(projectId, body.recordSetUuid(), null)
                .filter(set -> !datasetUuid.equals(set.datasetUuid()))
                .ifPresent(set -> {
                    throw RecordSetContainment.error("Record set '" + set.uid() + "' holds records of another dataset.");
                });
        RecordWriteResult result = recordService.create(
                new CreateRecordCommand(projectId, body.recordSetUuid(), body.displayName(), body.content()),
                ctx(projectKey, comment(body.comment(), "create record")));
        return ResponseEntity.status(201)
                .header(HttpHeaders.ETAG, RevisionHeaders.etag(result.record().revision()))
                .body(toDetail(result.record(), result.issues()));
    }

    @GetMapping("/records/{uuid}")
    @PreAuthorize("@projectAuth.has(#projectKey, " + ProjectRoleExpr.VIEWER + ")")
    public ResponseEntity<RecordDetailView> detail(
            @PathVariable String projectKey,
            @PathVariable UUID uuid,
            @RequestParam(value = "revision", required = false) Long revision) {
        RecordDetail record = recordService.find(projectId(projectKey), uuid, revision)
                .orElseThrow(() -> new SfException(ProblemFactory.notFound("Record not found.")));
        return ResponseEntity.ok()
                .header(HttpHeaders.ETAG, RevisionHeaders.etag(record.revision()))
                .body(toDetail(record, List.of()));
    }

    @PutMapping("/records/{uuid}")
    @PreAuthorize("@projectAuth.has(#projectKey, " + ProjectRoleExpr.EDITOR + ")")
    public ResponseEntity<RecordDetailView> update(
            @PathVariable String projectKey,
            @PathVariable UUID uuid,
            @RequestHeader(value = "If-Match", required = false) String ifMatch,
            @RequestBody UpdateRecordRequest body) {
        long expected = RevisionHeaders.expectedRevision(ifMatch);
        RecordWriteResult result = recordService.update(
                uuid, body.content(), body.displayName(), expected, ctx(projectKey, comment(body.comment(), "update record")));
        return ResponseEntity.ok()
                .header(HttpHeaders.ETAG, RevisionHeaders.etag(result.record().revision()))
                .body(toDetail(result.record(), result.issues()));
    }

    /** The paging envelope of a record listing; shared with {@link RecordSetController}'s set grid. */
    static RecordPageView toPageView(RecordPage result) {
        List<RecordRowView> rows = result.rows().stream()
                .map(r -> new RecordRowView(
                        r.uuid(), r.uid(), r.displayName(), r.folderPath(), r.changedAt(), r.changedBy(), r.values(),
                        r.selectedBySet()))
                .toList();
        return new RecordPageView(
                rows,
                new RecordPageView.PageMeta(result.size(), result.page(), result.totalElements(), result.totalPages()));
    }

    /**
     * The request's raw {@code sort} values as sort keys — read from the servlet request, not the bound list,
     * because Spring splits a single {@code field,desc} at the comma. Shared with {@link RecordSetController}
     * so both listings parse {@code sort} identically.
     */
    static List<SortKey> sortKeys(HttpServletRequest request) {
        String[] raw = request.getParameterValues("sort");
        return sortKeys(raw == null ? List.of() : List.of(raw));
    }

    /** {@code field}, {@code field,asc} or {@code field,desc}; anything else is a {@code 400}. */
    static List<SortKey> sortKeys(List<String> params) {
        List<SortKey> keys = new ArrayList<>();
        if (params == null) {
            return keys;
        }
        for (String param : params) {
            if (param == null || param.isBlank()) {
                continue;
            }
            String[] parts = param.split(",", -1);
            String field = parts[0].trim();
            String direction = parts.length > 1 ? parts[1].trim().toLowerCase(Locale.ROOT) : "asc";
            if (field.isEmpty() || parts.length > 2 || !(direction.equals("asc") || direction.equals("desc"))) {
                throw new SfException(ProblemFactory.badRequest("Invalid sort '" + param + "': expected field,asc|desc."));
            }
            keys.add(direction.equals("desc") ? SortKey.desc(field) : SortKey.asc(field));
        }
        return keys;
    }

    private static RecordDetailView toDetail(RecordDetail r, List<ContentIssue> issues) {
        return new RecordDetailView(
                r.uuid(),
                r.uid(),
                r.displayName(),
                r.datasetUuid(),
                r.datasetUid(),
                r.recordSetUuid() == null
                        ? null
                        : new AssetRefView(r.recordSetUuid(), r.recordSetUid(), r.recordSetDisplayName()),
                r.folderUuid(),
                r.folderPath(),
                r.content(),
                r.revision(),
                r.changedBy(),
                r.changedAt(),
                r.deleted(),
                issues);
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
