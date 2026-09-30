package com.acme.staticforge.api;

import com.acme.staticforge.api.dto.ChannelTemplateDto;
import com.acme.staticforge.api.dto.TemplateDetail;
import com.acme.staticforge.api.dto.TemplateSummary;
import com.acme.staticforge.asset.AssetSummary;
import com.acme.staticforge.asset.template.TemplateHierarchy;
import com.acme.staticforge.asset.template.TemplateListItem;
import com.acme.staticforge.asset.template.TemplateService;
import com.acme.staticforge.asset.template.TemplateView;
import com.acme.staticforge.project.ProjectService;
import com.acme.staticforge.revision.RevisionContext;
import com.acme.staticforge.security.SecuritySupport;
import com.acme.staticforge.template.cdl.CdlSources;
import com.acme.staticforge.template.content.EffectiveDefinition;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.List;

/**
 * Shared plumbing for the section/page template controllers: project resolution, revision
 * context construction and DTO mapping. Keeps each controller thin.
 */
abstract class AbstractTemplateController {

    protected final ProjectService projectService;
    protected final TemplateService templateService;
    protected final SecuritySupport securitySupport;
    protected final ObjectMapper objectMapper;

    AbstractTemplateController(
            ProjectService projectService, TemplateService templateService, SecuritySupport securitySupport,
            ObjectMapper objectMapper) {
        this.projectService = projectService;
        this.templateService = templateService;
        this.securitySupport = securitySupport;
        this.objectMapper = objectMapper;
    }

    protected long projectId(String key) {
        return projectService.requireByKey(key).getId();
    }

    protected RevisionContext ctx(String key, String comment) {
        return RevisionContext.of(projectId(key), securitySupport.currentUserId(), comment);
    }

    protected TemplateDetail toDetail(TemplateView v) {
        JsonNode payload = v.payload();
        EffectiveDefinition effective = v.effectiveDefinition();
        return new TemplateDetail(
                v.uuid(),
                v.uid(),
                v.kind().name(),
                v.displayName(),
                v.validFromRevision(),
                CdlSources.of(payload).content(),
                CdlSources.of(payload).bodies(),
                CdlSources.of(payload).rules(),
                payload.get("compiledDefinition"),
                payload.get("channelTemplates"),
                payload.path("category").asText(),
                payload.path("deprecated").asBoolean(false),
                payload.get("bodies"),
                payload.get("outputPath"),
                payload.get("paginationPath"),
                v.folderUuid(),
                v.folderPath(),
                v.isAbstract(),
                TemplateHierarchy.TemplateVersion.parentTemplateRef(payload),
                v.ancestors().stream().map(a -> new TemplateDetail.TemplateRefDto(a.uuid(), a.uid())).toList(),
                effective == null ? null : objectMapper.valueToTree(effective.definition()),
                effective == null ? null : new TemplateDetail.InheritedFrom(effective.editorsInheritedFrom(), effective.bodiesInheritedFrom()),
                descendantWarnings(v));
    }

    protected static TemplateSummary toSummary(TemplateListItem item) {
        AssetSummary s = item.summary();
        return new TemplateSummary(
                s.uuid(), s.uid(), s.type().name(), s.displayName(), s.folderPath(), s.validFromRevision(),
                item.abstractTemplate(), item.parentTemplateRef());
    }

    protected static ChannelTemplateDto toChannel(String channelKey, TemplateView view) {
        JsonNode channel = view.payload().path("channelTemplates").path(channelKey);
        return new ChannelTemplateDto(
                channelKey,
                channel.path("source").asText(),
                channel.path("compiledHash").asText(),
                channel.get("compiled"),
                descendantWarnings(view));
    }

    private static List<TemplateDetail.DescendantIssueDto> descendantWarnings(TemplateView view) {
        return view.descendantWarnings().stream()
                .map(w -> new TemplateDetail.DescendantIssueDto(w.uuid(), w.uid(), w.channel(), w.diagnostics()))
                .toList();
    }
}
