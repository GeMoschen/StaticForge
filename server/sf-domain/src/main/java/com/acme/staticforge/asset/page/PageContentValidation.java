package com.acme.staticforge.asset.page;

import com.acme.staticforge.asset.AssetRepository;
import com.acme.staticforge.asset.AssetType;
import com.acme.staticforge.asset.AssetVersionRepository;
import com.acme.staticforge.asset.content.ContentIssue;
import com.acme.staticforge.asset.content.PageContentValidator;
import com.acme.staticforge.asset.content.SectionTemplateLookup.SectionTemplate;
import com.acme.staticforge.asset.content.SectionTemplateLookup;
import com.acme.staticforge.asset.content.TemplateContentDefinitions;
import com.acme.staticforge.asset.dataset.RecordDatasets;
import com.acme.staticforge.asset.template.TemplateHierarchies;
import com.acme.staticforge.common.ProblemFactory;
import com.acme.staticforge.common.SfException;
import com.acme.staticforge.template.content.ContentDefinition;
import com.fasterxml.jackson.databind.JsonNode;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.function.Function;
import org.springframework.stereotype.Component;

/**
 * Content validation of page payloads against their live templates (spec §10.5). A save is
 * rejected only for {@link ContentIssue.Kind#STRUCTURAL} findings — a {@code 422 SF-API-0422}
 * problem listing them under {@code issues} — so a half-filled form still autosaves;
 * completeness findings are reported through {@link #issues} and block publish instead.
 *
 * <p>Content saved before validation existed may already be structurally invalid, so section and
 * body operations only check the subtree they change ({@link #requireValidSection},
 * {@link #requireValidBody}, {@link #requireValidContent}); a full-page update checks the whole
 * page ({@link #requireValidPage}).
 */
@Component
public class PageContentValidation {

    private final AssetRepository assetRepository;
    private final AssetVersionRepository assetVersionRepository;
    private final RecordDatasets recordDatasets;
    private final TemplateHierarchies hierarchies;

    public PageContentValidation(
            AssetRepository assetRepository,
            AssetVersionRepository assetVersionRepository,
            RecordDatasets recordDatasets,
            TemplateHierarchies hierarchies) {
        this.assetRepository = assetRepository;
        this.assetVersionRepository = assetVersionRepository;
        this.recordDatasets = recordDatasets;
        this.hierarchies = hierarchies;
    }

    /** A validator that checks dataset-restricted references against this project's records (M19.3.2). */
    private PageContentValidator validator(long projectId) {
        return new PageContentValidator(recordDatasets.validator(projectId));
    }

    /** Every finding on the page, structural and completeness; empty when its template doesn't resolve. */
    public List<ContentIssue> issues(long projectId, JsonNode payload) {
        PageContentValidator validator = validator(projectId);
        return validate(projectId, payload, (definition, sections) -> validator.validatePage(definition, payload, sections));
    }

    /** Rejects structural findings anywhere on the page. */
    public void requireValidPage(long projectId, JsonNode payload) {
        reject(issues(projectId, payload));
    }

    /** Rejects structural findings in the page's own {@code content}. */
    public void requireValidContent(long projectId, JsonNode payload) {
        PageContentValidator validator = validator(projectId);
        reject(validate(projectId, payload, (definition, sections) -> validator.validateContent(definition, payload, sections)));
    }

    /** Rejects structural findings in any section of {@code bodyName}. */
    public void requireValidBody(long projectId, JsonNode payload, String bodyName) {
        PageContentValidator validator = validator(projectId);
        reject(validate(projectId, payload,
                (definition, sections) -> validator.validateBody(definition, bodyName, payload, sections)));
    }

    /** Rejects structural findings in one section, including a template outside the body's {@code allow} list. */
    public void requireValidSection(long projectId, JsonNode payload, String bodyName, String instanceId) {
        PageContentValidator validator = validator(projectId);
        reject(validate(projectId, payload,
                (definition, sections) -> validator.validateSection(definition, bodyName, instanceId, payload, sections)));
    }

    /** Page content validates against the page template's effective definition: own and inherited editors (M20). */
    private List<ContentIssue> validate(long projectId, JsonNode payload, Check check) {
        UUID templateUuid;
        try {
            templateUuid = UUID.fromString(payload.path("templateRef").asText(""));
        } catch (IllegalArgumentException e) {
            return List.of();
        }
        return hierarchies.live(projectId).effectiveDefinition(templateUuid)
                .map(effective -> check.run(effective.definition(), sectionTemplates(projectId)))
                .orElse(List.of());
    }

    /**
     * A per-validation memo, so a template used by many sections or cards is resolved and compiled
     * once. Public for other content holders with catalog editors (dataset records, M19.1.2).
     */
    public SectionTemplateLookup sectionTemplates(long projectId) {
        Map<String, Optional<SectionTemplate>> resolved = new HashMap<>();
        Function<String, Optional<SectionTemplate>> resolve =
                templateRef -> liveTemplate(projectId, templateRef, AssetType.SECTION_TEMPLATE);
        return templateRef -> resolved.computeIfAbsent(templateRef, resolve);
    }

    /**
     * The live, non-deleted template of {@code type} that {@code templateRef} names, as its UID and
     * compiled definition (a page template's UID is simply unused).
     */
    private Optional<SectionTemplate> liveTemplate(long projectId, String templateRef, AssetType type) {
        UUID uuid;
        try {
            uuid = UUID.fromString(templateRef);
        } catch (IllegalArgumentException e) {
            return Optional.empty();
        }
        return assetRepository.findByProjectIdAndUuid(projectId, uuid)
                .filter(asset -> asset.getAssetType() == type)
                .flatMap(asset -> assetVersionRepository.findByAssetIdAndValidToRevisionIsNull(asset.getId())
                        .filter(version -> !version.isDeleted())
                        .map(version -> new SectionTemplate(asset.getUid(), TemplateContentDefinitions.of(version.getPayload()))));
    }

    private static void reject(List<ContentIssue> issues) {
        List<ContentIssue> structural = issues.stream()
                .filter(issue -> issue.kind() == ContentIssue.Kind.STRUCTURAL)
                .toList();
        if (structural.isEmpty()) {
            return;
        }
        String detail = "Page content is invalid: " + structural.get(0).path() + " — " + structural.get(0).message()
                + (structural.size() > 1 ? " (+" + (structural.size() - 1) + " more)" : "");
        throw new SfException(ProblemFactory.unprocessableEntity(detail, "issues", structural));
    }

    @FunctionalInterface
    private interface Check {
        List<ContentIssue> run(ContentDefinition pageDefinition, SectionTemplateLookup sections);
    }
}
