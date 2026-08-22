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

/**
 * Validates a content value object against its compiled {@link ContentDefinition} (spec §10.5,
 * §14.3–§14.4). Pure and dependency-free beyond the {@link ExpressionEvaluator}: it reports
 * findings, never mutates and never throws. The caller decides when {@link Severity#ERROR}
 * findings must block a publish as opposed to a save.
 */
public final class ContentValidator {

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
        List<ContentIssue> issues = new ArrayList<>();
        if (definition == null) {
            return issues;
        }
        JsonNode root = content == null || content.isMissingNode() ? NullNode.getInstance() : content;
        validateEditors(definition.editors(), root, root, "", issues);
        return issues;
    }

    private void validateEditors(
            List<EditorDefinition> editors, JsonNode scope, JsonNode node, String prefix, List<ContentIssue> issues) {
        for (EditorDefinition editor : editors) {
            String path = prefix.isEmpty() ? editor.name() : prefix + "." + editor.name();
            if (!isVisible(editor, scope, path, issues)) {
                continue;
            }
            if (editor.isGroup()) {
                validateEditors(editor.items(), scope, node, prefix, issues);
                continue;
            }
            JsonNode value = nodeValue(node, editor.name());
            if (editor.isList()) {
                validateList(editor, scope, value, path, issues);
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
        if (editor.required() && isEmpty(value)) {
            issues.add(new ContentIssue(path, "required", Severity.ERROR, "Required editor '" + editor.name() + "' is empty."));
            return;
        }
        if (isEmpty(value)) {
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
            EditorDefinition editor, JsonNode scope, JsonNode value, String path, List<ContentIssue> issues) {
        if (editor.required() && isEmpty(value)) {
            issues.add(new ContentIssue(path, "required", Severity.ERROR, "Required editor '" + editor.name() + "' is empty."));
        }
        if (isEmpty(value)) {
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
                validateEditors(editor.items(), scope, element, path + "[" + i + "]", issues);
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
            case RICHTEXT, LINK, GROUP -> value.isObject();
            case MEDIA -> isTyped(value, "MEDIA_REF");
            case REFERENCE -> isTyped(value, "ASSET_REF");
            case LIST -> value.isArray();
            case JSON -> true;
        };
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

    private static boolean isEmpty(JsonNode value) {
        if (value == null || value.isNull() || value.isMissingNode()) {
            return true;
        }
        if (value.isTextual() && value.asText().isBlank()) {
            return true;
        }
        return value.isArray() && value.isEmpty();
    }

    private static JsonNode nodeValue(JsonNode node, String name) {
        if (node == null || !node.isObject()) {
            return null;
        }
        return node.get(name);
    }
}
