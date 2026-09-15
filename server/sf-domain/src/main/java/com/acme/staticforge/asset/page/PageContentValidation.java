package com.acme.staticforge.asset.page;

import com.acme.staticforge.asset.AssetRepository;
import com.acme.staticforge.asset.AssetType;
import com.acme.staticforge.asset.AssetVersionRepository;
import com.acme.staticforge.asset.content.ContentIssue;
import com.acme.staticforge.asset.content.PageContentValidator;
import com.acme.staticforge.asset.content.SectionTemplateLookup;
import com.acme.staticforge.asset.content.SectionTemplateLookup.SectionTemplate;
import com.acme.staticforge.asset.content.TemplateContentDefinitions;
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
    private final PageContentValidator validator = new PageContentValidator();

    public PageContentValidation(AssetRepository assetRepository, AssetVersionRepository assetVersionRepository) {
        this.assetRepository = assetRepository;
        this.assetVersionRepository = assetVersionRepository;
    }

    /** Every finding on the page, structural and completeness; empty when its template doesn't resolve. */
    public List<ContentIssue> issues(long projectId, JsonNode payload) {
        return validate(projectId, payload, (definition, sections) -> validator.validatePage(definition, payload, sections));
    }

    /** Rejects structural findings anywhere on the page. */
    public void requireValidPage(long projectId, JsonNode payload) {
        reject(issues(projectId, payload));
    }

    /** Rejects structural findings in the page's own {@code content}. */
    public void requireValidContent(long projectId, JsonNode payload) {
        reject(validate(projectId, payload, (definition, sections) -> validator.validateContent(definition, payload, sections)));
    }

    /** Rejects structural findings in any section of {@code bodyName}. */
    public void requireValidBody(long projectId, JsonNode payload, String bodyName) {
        reject(validate(projectId, payload,
                (definition, sections) -> validator.validateBody(definition, bodyName, payload, sections)));
    }

    /** Rejects structural findings in one section, including a template outside the body's {@code allow} list. */
    public void requireValidSection(long projectId, JsonNode payload, String bodyName, String instanceId) {
        reject(validate(projectId, payload,
                (definition, sections) -> validator.validateSection(definition, bodyName, instanceId, payload, sections)));
    }

    private List<ContentIssue> validate(long projectId, JsonNode payload, Check check) {
        return liveTemplate(projectId, payload.path("templateRef").asText(""), AssetType.PAGE_TEMPLATE)
                .map(pageTemplate -> check.run(pageTemplate.definition(), sectionTemplates(projectId)))
                .orElse(List.of());
    }

    /** A per-validation memo, so a template used by many sections or cards is resolved and compiled once. */
    private SectionTemplateLookup sectionTemplates(long projectId) {
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
