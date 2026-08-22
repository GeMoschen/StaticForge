package com.acme.staticforge.api;

import com.acme.staticforge.api.dto.ChannelTemplateDto;
import com.acme.staticforge.api.dto.ChannelTemplateRequest;
import com.acme.staticforge.api.dto.StructureCreateRequest;
import com.acme.staticforge.api.dto.StructureDetail;
import com.acme.staticforge.api.dto.StructurePreviewRequest;
import com.acme.staticforge.api.dto.StructureSummary;
import com.acme.staticforge.api.dto.StructureUpdateRequest;
import com.acme.staticforge.asset.AssetSummary;
import com.acme.staticforge.asset.AssetType;
import com.acme.staticforge.common.ProblemFactory;
import com.acme.staticforge.common.SfException;
import com.acme.staticforge.generate.nav.NavigationBuilder;
import com.acme.staticforge.generate.render.OutputPathResolver;
import com.acme.staticforge.generate.snapshot.Snapshot;
import com.acme.staticforge.generate.snapshot.SnapshotAsset;
import com.acme.staticforge.generate.snapshot.SnapshotService;
import com.acme.staticforge.project.ProjectService;
import com.acme.staticforge.revision.RevisionContext;
import com.acme.staticforge.security.SecuritySupport;
import com.acme.staticforge.structure.StructureService;
import com.acme.staticforge.structure.StructureSource;
import com.acme.staticforge.structure.StructureSourceParser;
import com.acme.staticforge.structure.StructureView;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.UUID;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
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

/** Structure (navigation/breadcrumb/list) endpoints (spec §17.1, §20.2). */
@RestController
@RequestMapping("/api/v1/projects/{projectKey}/structures")
public class StructureController {

    private final ProjectService projectService;
    private final StructureService structureService;
    private final SnapshotService snapshotService;
    private final NavigationBuilder navigationBuilder;
    private final SecuritySupport securitySupport;
    private final ObjectMapper objectMapper;
    private final StructureSourceParser sourceParser = new StructureSourceParser();

    public StructureController(
            ProjectService projectService,
            StructureService structureService,
            SnapshotService snapshotService,
            NavigationBuilder navigationBuilder,
            SecuritySupport securitySupport,
            ObjectMapper objectMapper) {
        this.projectService = projectService;
        this.structureService = structureService;
        this.snapshotService = snapshotService;
        this.navigationBuilder = navigationBuilder;
        this.securitySupport = securitySupport;
        this.objectMapper = objectMapper;
    }

    @GetMapping
    @PreAuthorize("@projectAuth.has(#projectKey, " + ProjectRoleExpr.VIEWER + ")")
    public Page<StructureSummary> list(
            @PathVariable String projectKey,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "50") int size) {
        return structureService
                .list(projectId(projectKey), PageRequest.of(page, size))
                .map(StructureController::toSummary);
    }

    @PostMapping
    @PreAuthorize("@projectAuth.has(#projectKey, " + ProjectRoleExpr.DEVELOPER + ")")
    public ResponseEntity<StructureDetail> create(@PathVariable String projectKey, @RequestBody StructureCreateRequest body) {
        StructureView view = structureService.create(
                projectId(projectKey),
                body.folderUuid(),
                body.displayName(),
                body.kind(),
                body.sourceText(),
                body.channelSources(),
                ctx(projectKey, "create structure"));
        return ResponseEntity.ok()
                .header(HttpHeaders.ETAG, RevisionHeaders.etag(view.validFromRevision()))
                .body(toDetail(view));
    }

    @GetMapping("/{uuid}")
    @PreAuthorize("@projectAuth.has(#projectKey, " + ProjectRoleExpr.VIEWER + ")")
    public ResponseEntity<StructureDetail> detail(@PathVariable String projectKey, @PathVariable UUID uuid) {
        StructureView view = structureService.get(uuid);
        return ResponseEntity.ok()
                .header(HttpHeaders.ETAG, RevisionHeaders.etag(view.validFromRevision()))
                .body(toDetail(view));
    }

    @PutMapping("/{uuid}")
    @PreAuthorize("@projectAuth.has(#projectKey, " + ProjectRoleExpr.DEVELOPER + ")")
    public ResponseEntity<StructureDetail> update(
            @PathVariable String projectKey,
            @PathVariable UUID uuid,
            @RequestHeader(value = "If-Match", required = false) String ifMatch,
            @RequestBody StructureUpdateRequest body) {
        StructureView view = structureService.update(
                uuid,
                body.displayName(),
                body.sourceText(),
                body.channelSources(),
                RevisionHeaders.expectedRevision(ifMatch),
                ctx(projectKey, "update structure"));
        return ResponseEntity.ok()
                .header(HttpHeaders.ETAG, RevisionHeaders.etag(view.validFromRevision()))
                .body(toDetail(view));
    }

    @PutMapping("/{uuid}/channels/{channelKey}")
    @PreAuthorize("@projectAuth.has(#projectKey, " + ProjectRoleExpr.DEVELOPER + ")")
    public ResponseEntity<ChannelTemplateDto> saveChannel(
            @PathVariable String projectKey,
            @PathVariable UUID uuid,
            @PathVariable String channelKey,
            @RequestHeader(value = "If-Match", required = false) String ifMatch,
            @RequestBody ChannelTemplateRequest body) {
        StructureView view = structureService.saveChannel(
                uuid, channelKey, body.source(), RevisionHeaders.expectedRevision(ifMatch), ctx(projectKey, "set channel template"));
        return ResponseEntity.ok()
                .header(HttpHeaders.ETAG, RevisionHeaders.etag(view.validFromRevision()))
                .body(toChannel(channelKey, view.channelTemplates().path(channelKey)));
    }

    @PostMapping("/{uuid}/preview")
    @PreAuthorize("@projectAuth.has(#projectKey, " + ProjectRoleExpr.VIEWER + ")")
    public JsonNode preview(
            @PathVariable String projectKey,
            @PathVariable UUID uuid,
            @RequestBody(required = false) StructurePreviewRequest body) {
        long projectId = projectId(projectKey);
        Snapshot snapshot = snapshotService.snapshot(projectId, null);
        SnapshotAsset structure = snapshot.assetByUuid(uuid);
        if (structure == null || structure.type() != AssetType.STRUCTURE) {
            throw new SfException(ProblemFactory.notFound("Structure not found."));
        }
        StructureSource source = sourceParser.parse(structure.payload().path("sourceText").asText(""));
        OutputPathResolver paths = OutputPathResolver.forSnapshot(
                snapshot, OutputPathResolver.DEFAULT_INDEX_UID, false, "RELATIVE");
        UUID activePageUuid = body == null ? null : body.pageUuid();
        NavigationBuilder.NavBuildResult built = navigationBuilder.build(snapshot, source, activePageUuid, paths, "html");
        return objectMapper.valueToTree(built.root().children());
    }

    // ------------------------------------------------------------------
    // Helpers
    // ------------------------------------------------------------------

    private long projectId(String key) {
        return projectService.requireByKey(key).getId();
    }

    private RevisionContext ctx(String key, String comment) {
        return RevisionContext.of(projectId(key), securitySupport.currentUserId(), comment);
    }

    private static StructureDetail toDetail(StructureView view) {
        return new StructureDetail(
                view.uuid(),
                view.uid(),
                view.displayName(),
                view.kind().name(),
                view.sourceText(),
                view.source(),
                view.channelTemplates(),
                view.validFromRevision());
    }

    private static StructureSummary toSummary(AssetSummary summary) {
        return new StructureSummary(
                summary.uuid(), summary.uid(), summary.type().name(), summary.displayName(), summary.folderPath(), summary.validFromRevision());
    }

    private static ChannelTemplateDto toChannel(String channelKey, JsonNode channel) {
        return new ChannelTemplateDto(
                channelKey,
                channel.path("source").asText(),
                channel.path("compiledHash").asText(),
                channel.get("compiled"));
    }
}
