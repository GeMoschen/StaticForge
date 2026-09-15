package com.acme.staticforge.asset.content;

import com.acme.staticforge.template.content.ContentDefinition;
import com.acme.staticforge.template.content.EditorDefinition;
import com.acme.staticforge.template.content.EditorType;
import com.acme.staticforge.template.diagnostic.Severity;
import com.acme.staticforge.template.expression.ExpressionEvaluator;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.NullNode;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;

/**
 * Validates a content value object against its compiled {@link ContentDefinition} (spec §10.5,
 * §14.3–§14.4). Pure and dependency-free beyond the {@link ExpressionEvaluator}: it reports
 * findings, never mutates and never throws. The caller decides when {@link Severity#ERROR}
 * findings must block a publish as opposed to a save; {@link ContentIssue#kind()} classifies
 * each finding as structural (rejects a save) or completeness (blocks publish only).
 */
public final class ContentValidator {

    private static final Set<String> LINK_KINDS = Set.of("INTERNAL", "EXTERNAL", "MEDIA", "ANCHOR", "MAIL");

    private final ExpressionEvaluator evaluator;

    /** Creates a validator with a fresh expression evaluator. */
    public ContentValidator() {
        this(new ExpressionEvaluator());
    }

    /** Creates a validator backed by the supplied evaluator (useful in tests). */
    public ContentValidator(ExpressionEvaluator evaluator) {
        this.evaluator = evaluator;
    }

    /**
     * Validates {@code content} against {@code definition}, returning an empty list when the
     * value is valid. Fields gated by a {@code visibleWhen} expression that evaluates to
     * {@code false} are skipped entirely; unknown keys in {@code content} are ignored.
     */
    public List<ContentIssue> validate(ContentDefinition definition, JsonNode content) {
        return validate(definition, content, null, "");
    }

    /**
     * Validates {@code content} like {@link #validate(ContentDefinition, JsonNode)}, additionally
     * resolving each CATALOG card's template through {@code sections} (when non-null): a card whose
     * template doesn't resolve or isn't in the editor's {@code allow} list is a structural finding,
     * and the card's own {@code content} is validated against its template, recursively. Every
     * finding's path is rooted at {@code pathPrefix} (e.g. {@code bodies.main[2].content}; empty
     * for none).
     */
    public List<ContentIssue> validate(
            ContentDefinition definition, JsonNode content, SectionTemplateLookup sections, String pathPrefix) {
        List<ContentIssue> issues = new ArrayList<>();
        if (definition == null) {
            return issues;
        }
        JsonNode root = content == null || content.isMissingNode() ? NullNode.getInstance() : content;
        if (!root.isNull() && !root.isObject()) {
            issues.add(new ContentIssue(pathPrefix, "type", Severity.ERROR, "Content must be an object."));
            return issues;
        }
        validateEditors(definition.editors(), root, root, pathPrefix, sections, issues);
        return issues;
    }

    /**
     * Validates one section instance ({@code {instanceId, templateRef, content}}: a body section or
     * a catalog card): its template must resolve through {@code sections} and be admitted by
     * {@code allow}, and its {@code content} is validated against that template's definition,
     * recursing into nested catalogs. {@code owner} names the body/editor in messages; findings are
     * rooted at {@code instancePath}.
     */
    public List<ContentIssue> validateInstance(
            JsonNode instance, String instancePath, List<String> allow, String owner, SectionTemplateLookup sections) {
        List<ContentIssue> issues = new ArrayList<>();
        if (instance == null || !instance.isObject()) {
            issues.add(new ContentIssue(
                    instancePath, "type", Severity.ERROR, owner + " has a section instance that is not an object."));
            return issues;
        }
        String templateRef = instance.path("templateRef").asText("");
        Optional<SectionTemplateLookup.SectionTemplate> template = sections.find(templateRef);
        if (template.isEmpty()) {
            issues.add(new ContentIssue(
                    instancePath + ".templateRef", "template", Severity.ERROR,
                    owner + " references section template '" + templateRef + "', which does not exist."));
            return issues;
        }
        if (!template.get().allowedBy(allow)) {
            String name = template.get().uid() != null ? template.get().uid() : templateRef;
            issues.add(new ContentIssue(
                    instancePath + ".templateRef", "allow", Severity.ERROR,
                    owner + " does not allow section template '" + name + "'."));
            return issues;
        }
        issues.addAll(validate(template.get().definition(), instance.get("content"), sections, instancePath + ".content"));
        return issues;
    }

    private void validateEditors(
            List<EditorDefinition> editors,
            JsonNode scope,
            JsonNode node,
            String prefix,
            SectionTemplateLookup sections,
            List<ContentIssue> issues) {
        for (EditorDefinition editor : editors) {
            String path = prefix.isEmpty() ? editor.name() : prefix + "." + editor.name();
            if (!isVisible(editor, scope, path, issues)) {
                continue;
            }
            if (editor.isGroup()) {
                validateEditors(editor.items(), scope, node, prefix, sections, issues);
                continue;
            }
            JsonNode value = nodeValue(node, editor.name());
            if (editor.isList()) {
                validateList(editor, scope, value, path, sections, issues);
            } else if (editor.isCatalog()) {
                validateCatalog(editor, value, path, sections, issues);
            } else {
                validateScalar(editor, value, path, issues);
            }
        }
    }

    private boolean isVisible(EditorDefinition editor, JsonNode scope, String path, List<ContentIssue> issues) {
        String expression = editor.visibleWhen();
        if (expression == null || expression.isBlank()) {
            return true;
        }
        try {
            return evaluator.evaluate(expression, scope);
        } catch (IllegalArgumentException e) {
            issues.add(new ContentIssue(
                    path, "visibleWhen", Severity.WARNING, "Invalid visibleWhen expression: " + e.getMessage()));
            return true;
        }
    }

    private void validateScalar(EditorDefinition editor, JsonNode value, String path, List<ContentIssue> issues) {
        boolean empty = isEmpty(editor.type(), value);
        if (editor.required() && empty) {
            issues.add(new ContentIssue(path, "required", Severity.ERROR, "Required editor '" + editor.name() + "' is empty."));
            return;
        }
        if (empty) {
            return;
        }
        if (!matchesShape(editor.type(), value)) {
            issues.add(new ContentIssue(path, "type", Severity.ERROR, "Editor '" + editor.name() + "' has an invalid value shape."));
            return;
        }
        switch (editor.type()) {
            case TEXT, TEXTAREA, MARKDOWN -> validateTextConstraints(editor, value.asText(), path, issues);
            case RICHTEXT -> validateTextConstraints(editor, richtextText(value), path, issues);
            case NUMBER -> validateNumberBounds(editor, value, path, issues);
            case SELECT -> validateSelect(editor, value, path, issues);
            case MULTISELECT -> validateMultiselect(editor, value, path, issues);
            case MEDIA -> validateMime(editor, value, path, issues);
            default -> {
                // LINK, REFERENCE, COLOR, DATE, DATETIME, BOOLEAN, JSON: shape checked only.
            }
        }
    }

    private void validateList(
            EditorDefinition editor,
            JsonNode scope,
            JsonNode value,
            String path,
            SectionTemplateLookup sections,
            List<ContentIssue> issues) {
        boolean empty = isEmpty(editor.type(), value);
        if (editor.required() && empty) {
            issues.add(new ContentIssue(path, "required", Severity.ERROR, "Required editor '" + editor.name() + "' is empty."));
        }
        if (empty) {
            validateListBounds(editor, 0, path, issues);
            return;
        }
        if (!value.isArray()) {
            issues.add(new ContentIssue(path, "type", Severity.ERROR, "Editor '" + editor.name() + "' must be a list."));
            return;
        }
        validateListBounds(editor, value.size(), path, issues);
        for (int i = 0; i < value.size(); i++) {
            JsonNode element = value.get(i);
            if (element != null && element.isObject()) {
                validateEditors(editor.items(), scope, element, path + "[" + i + "]", sections, issues);
            } else {
                issues.add(new ContentIssue(
                        path + "[" + i + "]", "type", Severity.ERROR,
                        "Editor '" + editor.name() + "' has a list item that is not an object."));
            }
        }
    }

    /**
     * Validates a CATALOG editor's cardinality and per-card shape ({@code instanceId}/{@code
     * templateRef} present). A card's own fields come from another asset's template, not this
     * one's: they are validated only when a {@link SectionTemplateLookup} is supplied, which also
     * enforces the editor's {@code allow} list.
     */
    private void validateCatalog(
            EditorDefinition editor,
            JsonNode value,
            String path,
            SectionTemplateLookup sections,
            List<ContentIssue> issues) {
        boolean empty = isEmpty(editor.type(), value);
        if (editor.required() && empty) {
            issues.add(new ContentIssue(path, "required", Severity.ERROR, "Required editor '" + editor.name() + "' is empty."));
        }
        if (empty) {
            validateListBounds(editor, 0, path, issues);
            return;
        }
        if (!isTyped(value, "CATALOG") || !value.path("cards").isArray()) {
            issues.add(new ContentIssue(path, "type", Severity.ERROR, "Editor '" + editor.name() + "' has an invalid value shape."));
            return;
        }
        JsonNode cards = value.path("cards");
        validateListBounds(editor, cards.size(), path, issues);
        for (int i = 0; i < cards.size(); i++) {
            JsonNode card = cards.get(i);
            String cardPath = path + ".cards[" + i + "]";
            boolean valid = card != null && card.isObject()
                    && card.hasNonNull("instanceId") && card.hasNonNull("templateRef");
            if (!valid) {
                issues.add(new ContentIssue(
                        cardPath, "type", Severity.ERROR,
                        "Editor '" + editor.name() + "' has a card missing 'instanceId'/'templateRef'."));
            } else if (sections != null) {
                issues.addAll(validateInstance(card, cardPath, editor.allow(), "Editor '" + editor.name() + "'", sections));
            }
        }
    }

    private static void validateTextConstraints(
            EditorDefinition editor, String text, String path, List<ContentIssue> issues) {
        int length = text == null ? 0 : text.length();
        if (editor.maxLength() != null && length > editor.maxLength()) {
            issues.add(new ContentIssue(
                    path, "maxLength", Severity.ERROR,
                    "Editor '" + editor.name() + "' exceeds the maximum length of " + editor.maxLength() + "."));
        }
        if (editor.maxChars() != null && length > editor.maxChars()) {
            issues.add(new ContentIssue(
                    path, "maxChars", Severity.ERROR,
                    "Editor '" + editor.name() + "' exceeds the maximum of " + editor.maxChars() + " characters."));
        }
        if (editor.pattern() != null) {
            try {
                if (!text.matches(editor.pattern())) {
                    issues.add(new ContentIssue(path, "pattern", Severity.ERROR, patternMessage(editor)));
                }
            } catch (java.util.regex.PatternSyntaxException e) {
                issues.add(new ContentIssue(path, "pattern", Severity.WARNING, "Invalid pattern: " + e.getMessage()));
            }
        }
    }

    private void validateNumberBounds(EditorDefinition editor, JsonNode value, String path, List<ContentIssue> issues) {
        double number = value.asDouble();
        if (editor.min() != null && number < editor.min()) {
            issues.add(new ContentIssue(
                    path, "min", Severity.ERROR,
                    "Editor '" + editor.name() + "' must be at least " + editor.min() + "."));
        }
        if (editor.max() != null && number > editor.max()) {
            issues.add(new ContentIssue(
                    path, "max", Severity.ERROR,
                    "Editor '" + editor.name() + "' must be at most " + editor.max() + "."));
        }
    }

    private static void validateListBounds(EditorDefinition editor, int count, String path, List<ContentIssue> issues) {
        if (editor.min() != null && count < editor.min()) {
            issues.add(new ContentIssue(
                    path, "min", Severity.ERROR,
                    "Editor '" + editor.name() + "' requires at least " + editor.min() + " items."));
        }
        if (editor.max() != null && count > editor.max()) {
            issues.add(new ContentIssue(
                    path, "max", Severity.ERROR,
                    "Editor '" + editor.name() + "' allows at most " + editor.max() + " items."));
        }
    }

    private static void validateSelect(EditorDefinition editor, JsonNode value, String path, List<ContentIssue> issues) {
        String selected = value.asText();
        boolean allowed = editor.options().stream().anyMatch(o -> o.value().equals(selected));
        if (!allowed) {
            issues.add(new ContentIssue(
                    path, "option", Severity.ERROR,
                    "Editor '" + editor.name() + "' has a value that is not one of the allowed options."));
        }
    }

    private static void validateMultiselect(EditorDefinition editor, JsonNode value, String path, List<ContentIssue> issues) {
        if (!editor.options().isEmpty()) {
            for (JsonNode element : value) {
                String selected = element.asText();
                boolean allowed = editor.options().stream().anyMatch(o -> o.value().equals(selected));
                if (!allowed) {
                    issues.add(new ContentIssue(
                            path, "option", Severity.ERROR,
                            "Editor '" + editor.name() + "' has a value that is not one of the allowed options."));
                    return;
                }
            }
        }
    }

    private static void validateMime(EditorDefinition editor, JsonNode value, String path, List<ContentIssue> issues) {
        if (editor.mimeTypes().isEmpty()) {
            return;
        }
        String mime = mimeOf(value);
        if (mime == null) {
            return;
        }
        if (!editor.mimeTypes().contains(mime)) {
            issues.add(new ContentIssue(
                    path, "mimeType", Severity.ERROR,
                    "Editor '" + editor.name() + "' has a mime type '" + mime + "' that is not allowed."));
        }
    }

    private static String mimeOf(JsonNode value) {
        if (value == null || !value.isObject()) {
            return null;
        }
        for (String field : List.of("mimeType", "mime")) {
            JsonNode node = value.get(field);
            if (node != null && node.isTextual() && !node.asText().isBlank()) {
                return node.asText();
            }
        }
        return null;
    }

    private static String richtextText(JsonNode value) {
        if (value == null || !value.isObject()) {
            return "";
        }
        JsonNode text = value.get("value");
        return text != null && text.isTextual() ? text.asText() : "";
    }

    private static String patternMessage(EditorDefinition editor) {
        if (editor.patternMessage() != null && !editor.patternMessage().isBlank()) {
            return editor.patternMessage();
        }
        return "Editor '" + editor.name() + "' does not match the expected pattern.";
    }

    private static boolean matchesShape(EditorType type, JsonNode value) {
        return switch (type) {
            case TEXT, TEXTAREA, MARKDOWN, SELECT, COLOR, DATE, DATETIME -> value.isTextual();
            case NUMBER -> value.isNumber();
            case BOOLEAN -> value.isBoolean();
            case MULTISELECT -> value.isArray() && allTextual(value);
            case RICHTEXT -> value.isObject() && optionalText(value, "format") && optionalText(value, "value");
            case GROUP -> value.isObject();
            case LINK -> isLink(value);
            case MEDIA -> isTyped(value, "MEDIA_REF") && isUuid(value.get("uuid"))
                    && optionalText(value, "variant") && optionalText(value, "altOverride");
            case REFERENCE -> isTyped(value, "ASSET_REF") && isUuid(value.get("uuid")) && optionalText(value, "assetType");
            case LIST -> value.isArray();
            case CATALOG -> isTyped(value, "CATALOG");
            case JSON -> true;
        };
    }

    /** {@code {kind, uuid?, url?, anchor?, target?, title?}} with a known {@code kind} (spec §14.3). */
    private static boolean isLink(JsonNode value) {
        if (!value.isObject()) {
            return false;
        }
        JsonNode kind = value.get("kind");
        if (kind == null || !kind.isTextual() || !LINK_KINDS.contains(kind.asText())) {
            return false;
        }
        JsonNode uuid = value.get("uuid");
        return (uuid == null || uuid.isNull() || isUuid(uuid))
                && optionalText(value, "url")
                && optionalText(value, "anchor")
                && optionalText(value, "target")
                && optionalText(value, "title");
    }

    private static boolean isUuid(JsonNode node) {
        if (node == null || !node.isTextual()) {
            return false;
        }
        try {
            UUID.fromString(node.asText());
            return true;
        } catch (IllegalArgumentException e) {
            return false;
        }
    }

    /** True when {@code field} is absent, {@code null} or a string. */
    private static boolean optionalText(JsonNode object, String field) {
        JsonNode node = object.get(field);
        return node == null || node.isNull() || node.isTextual();
    }

    private static boolean isTyped(JsonNode value, String expectedType) {
        if (value == null || !value.isObject()) {
            return false;
        }
        JsonNode type = value.get("type");
        return type != null && type.isTextual() && expectedType.equals(type.asText());
    }

    private static boolean allTextual(JsonNode array) {
        for (JsonNode element : array) {
            if (!element.isTextual()) {
                return false;
            }
        }
        return true;
    }

    /**
     * Whether {@code value} counts as "not filled in" for an editor of {@code type}: absent/null,
     * blank text, an empty array or object, or the placeholder the form engine stores for an
     * untouched object editor — a MEDIA/REFERENCE ref without a {@code uuid}, a LINK without a
     * {@code uuid}/{@code url}/{@code anchor} (and no unknown {@code kind}), a RICHTEXT with a blank {@code value}, a CATALOG
     * without cards. A value of the wrong shape is never empty, so it still fails the shape check.
     */
    private static boolean isEmpty(EditorType type, JsonNode value) {
        if (value == null || value.isNull() || value.isMissingNode()) {
            return true;
        }
        if (value.isTextual()) {
            return value.asText().isBlank();
        }
        if (value.isArray()) {
            return value.isEmpty();
        }
        if (!value.isObject()) {
            return false;
        }
        if (value.isEmpty()) {
            return true;
        }
        return switch (type) {
            case MEDIA -> isTyped(value, "MEDIA_REF") && isBlank(value.get("uuid"));
            case REFERENCE -> isTyped(value, "ASSET_REF") && isBlank(value.get("uuid"));
            case LINK -> (isBlank(value.get("kind")) || LINK_KINDS.contains(value.get("kind").asText()))
                    && isBlank(value.get("uuid")) && isBlank(value.get("url")) && isBlank(value.get("anchor"));
            case RICHTEXT -> isBlank(value.get("value"));
            case CATALOG -> isTyped(value, "CATALOG") && value.path("cards").isArray() && value.path("cards").isEmpty();
            default -> false;
        };
    }

    private static boolean isBlank(JsonNode node) {
        return node == null || node.isNull() || (node.isTextual() && node.asText().isBlank());
    }

    private static JsonNode nodeValue(JsonNode node, String name) {
        if (node == null || !node.isObject()) {
            return null;
        }
        return node.get(name);
    }
}
