package com.acme.staticforge.api;

import com.acme.staticforge.api.dto.ChannelTemplateDto;
import com.acme.staticforge.api.dto.TemplateDetail;
import com.acme.staticforge.api.dto.TemplateSummary;
import com.acme.staticforge.asset.AssetSummary;
import com.acme.staticforge.asset.template.TemplateService;
import com.acme.staticforge.asset.template.TemplateView;
import com.acme.staticforge.project.ProjectService;
import com.acme.staticforge.revision.RevisionContext;
import com.acme.staticforge.security.SecuritySupport;
import com.fasterxml.jackson.databind.JsonNode;

/**
 * Shared plumbing for the section/page template controllers: project resolution, revision
 * context construction and DTO mapping. Keeps each controller thin.
 */
abstract class AbstractTemplateController {

    protected final ProjectService projectService;
    protected final TemplateService templateService;
    protected final SecuritySupport securitySupport;

    AbstractTemplateController(ProjectService projectService, TemplateService templateService, SecuritySupport securitySupport) {
        this.projectService = projectService;
        this.templateService = templateService;
        this.securitySupport = securitySupport;
    }

    protected long projectId(String key) {
        return projectService.requireByKey(key).getId();
    }

    protected RevisionContext ctx(String key, String comment) {
        return RevisionContext.of(projectId(key), securitySupport.currentUserId(), comment);
    }

    protected static TemplateDetail toDetail(TemplateView v) {
        JsonNode payload = v.payload();
        return new TemplateDetail(
                v.uuid(),
                v.uid(),
                v.kind().name(),
                v.displayName(),
                v.validFromRevision(),
                payload.path("contentDefinition").asText(),
                payload.get("compiledDefinition"),
                payload.get("channelTemplates"),
                payload.path("category").asText(),
                payload.path("deprecated").asBoolean(false),
                payload.get("bodies"),
                payload.get("outputPath"));
    }

    protected static TemplateSummary toSummary(AssetSummary s) {
        return new TemplateSummary(s.uuid(), s.uid(), s.type().name(), s.displayName(), s.folderPath(), s.validFromRevision());
    }

    protected static ChannelTemplateDto toChannel(String channelKey, JsonNode channel) {
        return new ChannelTemplateDto(
                channelKey,
                channel.path("source").asText(),
                channel.path("compiledHash").asText(),
                channel.get("compiled"));
    }
}
