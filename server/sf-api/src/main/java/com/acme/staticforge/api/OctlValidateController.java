package com.acme.staticforge.api;

import com.acme.staticforge.api.dto.OctlValidateRequest;
import com.acme.staticforge.api.dto.OctlValidateResponse;
import com.acme.staticforge.asset.template.TemplateService;
import com.acme.staticforge.common.ProblemFactory;
import com.acme.staticforge.common.SfException;
import com.acme.staticforge.project.ProjectService;
import com.acme.staticforge.template.octl.OctlCompiler;
import com.acme.staticforge.template.octl.OctlResult;
import java.util.UUID;
import org.springframework.http.MediaType;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * OCTL validation endpoint (spec §16.11, §20.2). Compiles OCTL and returns positioned diagnostics so the editor can
 * show them while typing.
 *
 * <p>Without {@code templateUuid} the source compiles on its own: the structural catalogue (unknown instruction,
 * unbalanced block, unknown filter, inheritance placement rules) and {@code $CMS_BODY} placement. With it (M20.4.1)
 * the source is validated as that template's channel, returning the diagnostics a save would: resolved references,
 * the linked inheritance chain, and names checked against the effective definition, built from the request's
 * unsaved CDL when given.
 */
@RestController
@RequestMapping("/api/v1/projects/{projectKey}/octl")
public class OctlValidateController {

    private final OctlCompiler octlCompiler = new OctlCompiler();
    private final ProjectService projectService;
    private final TemplateService templateService;

    public OctlValidateController(ProjectService projectService, TemplateService templateService) {
        this.projectService = projectService;
        this.templateService = templateService;
    }

    @PostMapping(value = "/validate", produces = MediaType.APPLICATION_JSON_VALUE)
    @PreAuthorize("@projectAuth.has(#projectKey, " + ProjectRoleExpr.DEVELOPER + ")")
    public OctlValidateResponse validate(
            @PathVariable("projectKey") String projectKey, @RequestBody OctlValidateRequest body) {
        if (body.templateUuid() == null || body.templateUuid().isBlank()) {
            OctlResult result = octlCompiler.compile(body.source(), body.channelKey(), null);
            return new OctlValidateResponse(result.diagnostics());
        }
        UUID templateUuid;
        try {
            templateUuid = UUID.fromString(body.templateUuid());
        } catch (IllegalArgumentException e) {
            throw new SfException(ProblemFactory.unprocessableEntity("templateUuid is not a UUID."));
        }
        long projectId = projectService.requireByKey(projectKey).getId();
        return new OctlValidateResponse(templateService.validateChannel(
                projectId, templateUuid, body.channelKey(), body.source(), body.contentDefinition()));
    }
}
