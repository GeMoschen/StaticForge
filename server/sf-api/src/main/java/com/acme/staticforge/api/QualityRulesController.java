package com.acme.staticforge.api;

import com.acme.staticforge.api.dto.QualityRulesRequest;
import com.acme.staticforge.api.dto.QualityRulesView;
import com.acme.staticforge.common.Problem;
import com.acme.staticforge.common.SfException;
import com.acme.staticforge.generate.quality.EffectiveQualityConfig;
import com.acme.staticforge.generate.quality.QualityRule;
import com.acme.staticforge.generate.quality.QualityRuleConfig;
import com.acme.staticforge.generate.quality.QualityRuleConfigService;
import com.acme.staticforge.generate.quality.QualityRuleConfigService.InvalidQualityConfigException;
import com.acme.staticforge.generate.quality.RuleParam;
import com.acme.staticforge.generate.quality.SiteRule;
import com.acme.staticforge.project.Project;
import com.acme.staticforge.project.ProjectService;
import com.acme.staticforge.revision.RevisionContext;
import com.acme.staticforge.security.SecuritySupport;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * The per-project quality rule configuration (M30.1.2, epic decision 4): every rule off, warning or error, with its
 * parameters. Every member reads it; developers change it — the templates own the markup the rules check. A change is
 * a revision plus the audit action {@code QUALITY_RULES_UPDATED}; archived projects refuse it ({@code 409
 * SF-DOM-0141}).
 */
@RestController
@RequestMapping("/api/v1/projects/{projectKey}/quality-rules")
public class QualityRulesController {

    /** Which outputs every rule checks (epic decision 2). */
    static final String CHANNELS_NOTE = "HTML channels only";

    private final QualityRuleConfigService configService;
    private final ProjectService projectService;
    private final SecuritySupport securitySupport;

    public QualityRulesController(
            QualityRuleConfigService configService, ProjectService projectService, SecuritySupport securitySupport) {
        this.configService = configService;
        this.projectService = projectService;
        this.securitySupport = securitySupport;
    }

    @GetMapping
    @PreAuthorize("@projectAuth.has(#projectKey, " + ProjectRoleExpr.VIEWER + ")")
    public QualityRulesView get(@PathVariable String projectKey) {
        return view(configService.effective(projectKey));
    }

    /**
     * Replaces the configuration; a rule missing from the body is at its default. {@code 400 SF-API-0400} with one
     * message per invalid entry under {@code errors}; a body that changes nothing answers {@code 200} and records
     * nothing.
     */
    @PutMapping
    @PreAuthorize("@projectAuth.has(#projectKey, " + ProjectRoleExpr.DEVELOPER + ")")
    public QualityRulesView update(@PathVariable String projectKey, @RequestBody QualityRulesRequest body) {
        Project project = projectService.requireByKey(projectKey);
        Map<String, QualityRuleConfig.Entry> entries = new LinkedHashMap<>();
        if (body != null && body.rules() != null) {
            body.rules().forEach((code, entry) -> entries.put(code, entry == null
                    ? new QualityRuleConfig.Entry(null, null)
                    : new QualityRuleConfig.Entry(entry.severity(), entry.params())));
        }
        try {
            return view(configService.update(
                    projectKey, entries, RevisionContext.of(project.getId(), securitySupport.currentUserId(), null)));
        } catch (InvalidQualityConfigException e) {
            throw new SfException(Problem.builder()
                    .type("https://cms.example.com/problems/sf-api-0400")
                    .title("Bad Request")
                    .status(400)
                    .detail("The quality rule configuration is invalid.")
                    .property("code", "SF-API-0400")
                    .property("errors", e.errors())
                    .build());
        }
    }

    private static QualityRulesView view(EffectiveQualityConfig config) {
        return new QualityRulesView(config.registry().all().stream().map(rule -> rule(rule, config)).toList());
    }

    private static QualityRulesView.QualityRuleItem rule(QualityRule rule, EffectiveQualityConfig config) {
        EffectiveQualityConfig.RuleSetting setting = config.setting(rule.code());
        List<QualityRulesView.QualityRuleParam> params = rule.params().stream()
                .map(param -> param(param, setting.params().get(param.name())))
                .toList();
        return new QualityRulesView.QualityRuleItem(
                rule.code(),
                rule.name(),
                rule.category().name(),
                rule instanceof SiteRule ? "SITE" : "PAGE",
                rule.description(),
                rule.fixHint().name(),
                rule.defaultSeverity().name(),
                setting.severity().name(),
                rule.maxSeverity().name(),
                params,
                CHANNELS_NOTE);
    }

    private static QualityRulesView.QualityRuleParam param(RuleParam param, Object value) {
        return new QualityRulesView.QualityRuleParam(
                param.name(), param.type().name(), value, param.defaultValue(), param.min(), param.max(),
                param.description());
    }
}
