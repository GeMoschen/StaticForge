package com.acme.staticforge.generate.quality;

import com.acme.staticforge.audit.AuditService;
import com.acme.staticforge.project.Project;
import com.acme.staticforge.project.ProjectRepository;
import com.acme.staticforge.project.ProjectService;
import com.acme.staticforge.project.ProjectWriteGuard;
import com.acme.staticforge.revision.AssetChange;
import com.acme.staticforge.revision.ChangeType;
import com.acme.staticforge.revision.Revision;
import com.acme.staticforge.revision.RevisionAware;
import com.acme.staticforge.revision.RevisionContext;
import com.acme.staticforge.revision.RevisionService;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.List;
import java.util.Map;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** {@link QualityRuleConfigService} over {@code project.quality_rule_config} (M30.1.2). */
@Service
@RevisionAware
public class QualityRuleConfigServiceImpl implements QualityRuleConfigService {

    /** The field a {@code PROJECT} revision summary entry names for a configuration change. */
    public static final String SUMMARY_FIELD = "qualityRules";

    /** The audit action of a configuration change. */
    public static final String AUDIT_ACTION = "QUALITY_RULES_UPDATED";

    private final QualityRuleRegistry registry;
    private final ProjectService projectService;
    private final ProjectRepository projectRepository;
    private final ProjectWriteGuard writeGuard;
    private final RevisionService revisionService;
    private final AuditService auditService;

    public QualityRuleConfigServiceImpl(
            QualityRuleRegistry registry,
            ProjectService projectService,
            ProjectRepository projectRepository,
            ProjectWriteGuard writeGuard,
            RevisionService revisionService,
            AuditService auditService) {
        this.registry = registry;
        this.projectService = projectService;
        this.projectRepository = projectRepository;
        this.writeGuard = writeGuard;
        this.revisionService = revisionService;
        this.auditService = auditService;
    }

    @Override
    @Transactional(readOnly = true)
    public EffectiveQualityConfig effective(long projectId) {
        return projectRepository.findById(projectId)
                .map(this::effectiveOf)
                .orElseGet(() -> EffectiveQualityConfig.defaults(registry));
    }

    @Override
    @Transactional(readOnly = true)
    public EffectiveQualityConfig effective(String projectKey) {
        return effectiveOf(projectService.requireByKey(projectKey));
    }

    private EffectiveQualityConfig effectiveOf(Project project) {
        return EffectiveQualityConfig.of(registry, QualityRuleConfig.read(registry, project.getQualityRuleConfig()));
    }

    @Override
    @Transactional
    public EffectiveQualityConfig update(
            String projectKey, Map<String, QualityRuleConfig.Entry> entries, RevisionContext ctx) {
        Project project = projectService.requireByKey(projectKey);
        writeGuard.requireWritable(project);
        QualityRuleConfig.Validation validation = QualityRuleConfig.validate(registry, entries);
        if (!validation.valid()) {
            throw new InvalidQualityConfigException(validation.errors());
        }
        EffectiveQualityConfig before = effectiveOf(project);
        EffectiveQualityConfig after = EffectiveQualityConfig.of(registry, validation.settings());
        List<String> changed = QualityRuleConfig.changedCodes(before, after);
        if (changed.isEmpty()) {
            return before;
        }
        project.setQualityRuleConfig(QualityRuleConfig.write(after));
        projectRepository.save(project);

        Revision revision = revisionService.allocate(project.getId(), ChangeType.UPDATE, ctx.comment(), ctx.userId());
        revisionService.appendSummary(
                project.getId(),
                revision.getRevisionId(),
                AssetChange.create("project-" + project.getId(), "PROJECT", "UPDATE", List.of(SUMMARY_FIELD)));
        ObjectNode detail = JsonNodeFactory.instance.objectNode();
        ArrayNode codes = detail.putArray("changed");
        changed.forEach(codes::add);
        auditService.record(project.getId(), ctx.userId(), AUDIT_ACTION, "project:" + project.getKey(), detail);
        return after;
    }

    @Override
    @Transactional(readOnly = true)
    public boolean qualityRulesChangedSince(long projectId, long revision) {
        for (Revision later : revisionService.findRecent(projectId, revision, null, null, Pageable.unpaged())) {
            JsonNode assets = later.getSummary() == null ? null : later.getSummary().get("assets");
            if (assets == null || !assets.isArray()) {
                continue;
            }
            for (JsonNode change : assets) {
                if ("PROJECT".equals(change.path("type").asText()) && names(change.path("fields"), SUMMARY_FIELD)) {
                    return true;
                }
            }
        }
        return false;
    }

    private static boolean names(JsonNode fields, String field) {
        for (JsonNode name : fields) {
            if (field.equals(name.asText())) {
                return true;
            }
        }
        return false;
    }
}
