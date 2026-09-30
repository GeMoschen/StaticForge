package com.acme.staticforge.api;

import com.acme.staticforge.api.dto.RuleEvaluationRequest;
import com.acme.staticforge.api.dto.RuleEvaluationView;
import com.acme.staticforge.asset.rules.ContentRules;
import com.acme.staticforge.asset.rules.RuleOutcome;
import com.acme.staticforge.common.ProblemFactory;
import com.acme.staticforge.common.SfException;
import com.acme.staticforge.project.ProjectService;
import com.acme.staticforge.security.RenderRateLimiter;
import com.acme.staticforge.security.SecuritySupport;
import java.util.Locale;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * Editor rules, live (M33.5): {@code POST /rules/evaluate} runs the {@code edit} scope on a value the editor hasn't
 * saved — findings, fills, field states — reading drafts and storing nothing. {@code VIEWER}; allowed on an archived
 * project (read-only, like a draft check); rate limited per user on the draft-check budget ({@code 429 SF-API-0429}).
 */
@RestController
@RequestMapping("/api/v1/projects/{projectKey}/rules")
public class RulesController {

    private final ProjectService projectService;
    private final ContentRules contentRules;
    private final RenderRateLimiter rateLimiter;
    private final SecuritySupport securitySupport;

    public RulesController(
            ProjectService projectService,
            ContentRules contentRules,
            RenderRateLimiter rateLimiter,
            SecuritySupport securitySupport) {
        this.projectService = projectService;
        this.contentRules = contentRules;
        this.rateLimiter = rateLimiter;
        this.securitySupport = securitySupport;
    }

    @AllowedOnArchivedProject("read-only rule evaluation")
    @PostMapping("/evaluate")
    @PreAuthorize("@projectAuth.has(#projectKey, " + ProjectRoleExpr.VIEWER + ")")
    public RuleEvaluationView evaluate(@PathVariable String projectKey, @RequestBody RuleEvaluationRequest body) {
        long projectId = projectService.requireByKey(projectKey).getId();
        rateLimiter.acquireCheck(securitySupport.currentUserId());
        RuleOutcome outcome = contentRules.edit(projectId, new ContentRules.EditRequest(
                kind(body.kind()), body.assetUuid(), body.templateUid(), body.datasetUid(), body.globalSetUid(),
                body.content(), body.bodies(), body.locale()));
        return new RuleEvaluationView(outcome.findings(), outcome.fills(), outcome.fieldStates());
    }

    private static ContentRules.EditKind kind(String kind) {
        if (kind == null || kind.isBlank()) {
            throw new SfException(ProblemFactory.badRequest("kind is required.", "kind"));
        }
        try {
            return ContentRules.EditKind.valueOf(kind.trim().toUpperCase(Locale.ROOT));
        } catch (IllegalArgumentException e) {
            throw new SfException(ProblemFactory.badRequest(
                    "kind must be PAGE, SECTION, RECORD or GLOBAL_SET.", "kind"));
        }
    }
}
