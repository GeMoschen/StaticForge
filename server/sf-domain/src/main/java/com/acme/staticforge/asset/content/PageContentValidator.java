package com.acme.staticforge.asset.content;

import com.acme.staticforge.template.content.BodyDefinition;
import com.acme.staticforge.template.content.ContentDefinition;
import com.acme.staticforge.template.diagnostic.Severity;
import com.fasterxml.jackson.databind.JsonNode;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;

/**
 * Validates a page payload ({@code {templateRef, content, bodies, …}}, spec §10.3) against its page
 * template's {@link ContentDefinition}: the page's own {@code content}, each body's cardinality and
 * {@code allow} list (§14.6), and every section instance's content against its own section
 * template, recursing into catalog cards. Findings carry payload-rooted paths such as
 * {@code content.headline} or {@code bodies.main[2].content.links[0].target}. Pure: section
 * templates come from the caller's {@link SectionTemplateLookup}.
 */
public final class PageContentValidator {

    private final ContentValidator validator;

    public PageContentValidator() {
        this(new ContentValidator());
    }

    public PageContentValidator(ContentValidator validator) {
        this.validator = validator;
    }

    /** Every finding on the page: its content, every declared or stored body, and every section. */
    public List<ContentIssue> validatePage(
            ContentDefinition pageDefinition, JsonNode payload, SectionTemplateLookup sections) {
        List<ContentIssue> issues = new ArrayList<>(validateContent(pageDefinition, payload, sections));
        JsonNode bodies = payload.get("bodies");
        if (bodies != null && !bodies.isNull() && !bodies.isObject()) {
            issues.add(new ContentIssue("bodies", "type", Severity.ERROR, "Page bodies must be an object."));
            return issues;
        }
        for (BodyDefinition body : pageDefinition.bodies()) {
            if (bodies == null || !bodies.has(body.name())) {
                issues.addAll(validateBody(pageDefinition, body.name(), payload, sections));
            }
        }
        if (bodies != null && bodies.isObject()) {
            bodies.fieldNames().forEachRemaining(name -> issues.addAll(validateBody(pageDefinition, name, payload, sections)));
        }
        return issues;
    }

    /** Findings on the page's own {@code content} only. */
    public List<ContentIssue> validateContent(
            ContentDefinition pageDefinition, JsonNode payload, SectionTemplateLookup sections) {
        return validator.validate(pageDefinition, payload.get("content"), sections, "content");
    }

    /** Findings on one body: its declared cardinality and every section instance in it. */
    public List<ContentIssue> validateBody(
            ContentDefinition pageDefinition, String bodyName, JsonNode payload, SectionTemplateLookup sections) {
        List<ContentIssue> issues = new ArrayList<>();
        String bodyPath = "bodies." + bodyName;
        JsonNode body = payload.path("bodies").get(bodyName);
        if (body != null && !body.isNull() && !body.isArray()) {
            issues.add(new ContentIssue(bodyPath, "type", Severity.ERROR, "Body '" + bodyName + "' must be a list of sections."));
            return issues;
        }
        int count = body == null || body.isNull() ? 0 : body.size();
        Optional<BodyDefinition> definition = pageDefinition.findBody(bodyName);
        definition.ifPresent(d -> validateCardinality(d, count, bodyPath, issues));
        for (int i = 0; i < count; i++) {
            issues.addAll(validateSectionAt(definition, bodyName, i, body.get(i), sections));
        }
        return issues;
    }

    /**
     * Findings on the section instance {@code instanceId} in {@code bodyName} (its template must be
     * in the body's {@code allow} list); empty when the payload holds no such section.
     */
    public List<ContentIssue> validateSection(
            ContentDefinition pageDefinition,
            String bodyName,
            String instanceId,
            JsonNode payload,
            SectionTemplateLookup sections) {
        JsonNode body = payload.path("bodies").path(bodyName);
        for (int i = 0; i < body.size(); i++) {
            JsonNode section = body.get(i);
            if (instanceId.equals(section.path("instanceId").asText())) {
                return validateSectionAt(pageDefinition.findBody(bodyName), bodyName, i, section, sections);
            }
        }
        return List.of();
    }

    /**
     * A section in a body the page template doesn't declare (an orphaned body, §10.3) is retained
     * as-is: no allow list applies, but its content is still validated.
     */
    private List<ContentIssue> validateSectionAt(
            Optional<BodyDefinition> body, String bodyName, int index, JsonNode section, SectionTemplateLookup sections) {
        List<String> allow = body.map(BodyDefinition::allow).orElse(List.of());
        return validator.validateInstance(
                section, "bodies." + bodyName + "[" + index + "]", allow, "Body '" + bodyName + "'", sections);
    }

    private static void validateCardinality(BodyDefinition body, int count, String path, List<ContentIssue> issues) {
        if (body.min() != null && count < body.min()) {
            issues.add(new ContentIssue(
                    path, "min", Severity.ERROR,
                    "Body '" + body.name() + "' requires at least " + body.min() + " sections."));
        }
        if (body.max() != null && count > body.max()) {
            issues.add(new ContentIssue(
                    path, "max", Severity.ERROR,
                    "Body '" + body.name() + "' allows at most " + body.max() + " sections."));
        }
    }
}
