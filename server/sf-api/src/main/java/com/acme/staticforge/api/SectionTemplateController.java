package com.acme.staticforge.api;

import com.acme.staticforge.api.dto.ChannelTemplateDto;
import com.acme.staticforge.api.dto.ChannelTemplateRequest;
import com.acme.staticforge.api.dto.CreateTemplateRequest;
import com.acme.staticforge.api.dto.TemplateDetail;
import com.acme.staticforge.api.dto.TemplateSummary;
import com.acme.staticforge.api.dto.UpdateTemplateRequest;
import com.acme.staticforge.asset.AssetType;
import com.acme.staticforge.asset.template.CreateTemplateCommand;
import com.acme.staticforge.asset.template.TemplateService;
import com.acme.staticforge.asset.template.TemplateView;
import com.acme.staticforge.asset.template.UpdateTemplateCommand;
import com.acme.staticforge.project.ProjectService;
import com.acme.staticforge.security.SecuritySupport;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.UUID;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
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

/** Section-template endpoints (spec §20.2). */
@RestController
@RequestMapping("/api/v1/projects/{projectKey}/section-templates")
public class SectionTemplateController extends AbstractTemplateController {

    public SectionTemplateController(
            ProjectService projectService, TemplateService templateService, SecuritySupport securitySupport,
            ObjectMapper objectMapper) {
        super(projectService, templateService, securitySupport, objectMapper);
    }

    @GetMapping
    @PreAuthorize("@projectAuth.has(#projectKey, " + ProjectRoleExpr.VIEWER + ")")
    public Page<TemplateSummary> list(
            @PathVariable String projectKey,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "50") int size) {
        return templateService
                .list(projectId(projectKey), AssetType.SECTION_TEMPLATE, PageRequest.of(page, size), ctx(projectKey, "list section templates"))
                .map(AbstractTemplateController::toSummary);
    }

    @PostMapping
    @PreAuthorize("@projectAuth.has(#projectKey, " + ProjectRoleExpr.DEVELOPER + ")")
    public ResponseEntity<TemplateDetail> create(@PathVariable String projectKey, @RequestBody CreateTemplateRequest body) {
        TemplateView view = templateService.create(
                new CreateTemplateCommand(
                        projectId(projectKey),
                        AssetType.SECTION_TEMPLATE,
                        body.displayName(),
                        body.contentDefinition(),
                        body.channelSources(),
                        body.category(),
                        Boolean.TRUE.equals(body.deprecated()),
                        body.outputPath(),
                        body.parentFolderUuid()),
                ctx(projectKey, "create section template"));
        return ResponseEntity.ok()
                .header(HttpHeaders.ETAG, RevisionHeaders.etag(view.validFromRevision()))
                .body(toDetail(view));
    }

    @GetMapping("/{uuid}")
    @PreAuthorize("@projectAuth.has(#projectKey, " + ProjectRoleExpr.VIEWER + ")")
    public ResponseEntity<TemplateDetail> detail(@PathVariable String projectKey, @PathVariable UUID uuid) {
        TemplateView view = templateService.get(projectId(projectKey), uuid);
        return ResponseEntity.ok()
                .header(HttpHeaders.ETAG, RevisionHeaders.etag(view.validFromRevision()))
                .body(toDetail(view));
    }

    @PutMapping("/{uuid}")
    @PreAuthorize("@projectAuth.has(#projectKey, " + ProjectRoleExpr.DEVELOPER + ")")
    public ResponseEntity<TemplateDetail> update(
            @PathVariable String projectKey,
            @PathVariable UUID uuid,
            @RequestHeader(value = "If-Match", required = false) String ifMatch,
            @RequestBody UpdateTemplateRequest body) {
        TemplateView view = templateService.update(
                uuid,
                new UpdateTemplateCommand(
                        body.displayName(),
                        body.contentDefinition(),
                        body.channelSources(),
                        body.category(),
                        Boolean.TRUE.equals(body.deprecated()),
                        body.outputPath()),
                RevisionHeaders.expectedRevision(ifMatch),
                ctx(projectKey, "update section template"));
        return ResponseEntity.ok()
                .header(HttpHeaders.ETAG, RevisionHeaders.etag(view.validFromRevision()))
                .body(toDetail(view));
    }

    @DeleteMapping("/{uuid}")
    @PreAuthorize("@projectAuth.has(#projectKey, " + ProjectRoleExpr.DEVELOPER + ")")
    public ResponseEntity<Void> delete(@PathVariable String projectKey, @PathVariable UUID uuid) {
        templateService.delete(uuid, ctx(projectKey, "delete section template"));
        return ResponseEntity.noContent().build();
    }

    @PutMapping("/{uuid}/channels/{channelKey}")
    @PreAuthorize("@projectAuth.has(#projectKey, " + ProjectRoleExpr.DEVELOPER + ")")
    public ResponseEntity<ChannelTemplateDto> saveChannel(
            @PathVariable String projectKey,
            @PathVariable UUID uuid,
            @PathVariable String channelKey,
            @RequestHeader(value = "If-Match", required = false) String ifMatch,
            @RequestBody ChannelTemplateRequest body) {
        TemplateView view = templateService.saveChannel(
                uuid, channelKey, body.source(), RevisionHeaders.expectedRevision(ifMatch), ctx(projectKey, "set channel template"));
        return ResponseEntity.ok()
                .header(HttpHeaders.ETAG, RevisionHeaders.etag(view.validFromRevision()))
                .body(toChannel(channelKey, view));
    }

    @DeleteMapping("/{uuid}/channels/{channelKey}")
    @PreAuthorize("@projectAuth.has(#projectKey, " + ProjectRoleExpr.DEVELOPER + ")")
    public ResponseEntity<Void> deleteChannel(
            @PathVariable String projectKey,
            @PathVariable UUID uuid,
            @PathVariable String channelKey,
            @RequestHeader(value = "If-Match", required = false) String ifMatch) {
        templateService.deleteChannel(
                uuid, channelKey, RevisionHeaders.expectedRevision(ifMatch), ctx(projectKey, "delete channel template"));
        return ResponseEntity.noContent().build();
    }
}
