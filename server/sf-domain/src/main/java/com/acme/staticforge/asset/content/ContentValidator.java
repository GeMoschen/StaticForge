package com.acme.staticforge.asset.content;

import com.acme.staticforge.common.L10nValues;
import com.acme.staticforge.template.content.ContentDefinition;
import com.acme.staticforge.template.content.EditorDefinition;
import com.acme.staticforge.template.content.EditorType;
import com.acme.staticforge.template.content.PaginationOptions;
import com.acme.staticforge.template.diagnostic.Severity;
import com.acme.staticforge.template.expression.ExpressionEvaluator;
import com.acme.staticforge.template.query.DatasetQueryParser;
import com.acme.staticforge.template.query.RecordView;
import com.acme.staticforge.template.rules.BuiltinRule;
import com.acme.staticforge.template.rules.RuleMessages;
import com.acme.staticforge.template.rules.RuleScope;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.NullNode;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;

/**
 * Validates a content value object against its compiled {@link ContentDefinition} (spec §10.5,
 * §14.3–§14.4). Pure and dependency-free beyond the {@link ExpressionEvaluator}: it reports
 * findings, never mutates and never throws. The caller decides when {@link Severity#ERROR}
 * findings must block a publish as opposed to a save; {@link ContentIssue#kind()} classifies
 * each finding as structural (rejects a save) or completeness (blocks publish only).
 *
 * <p>The built-in checks ({@code required}, {@code maxLength}, {@code maxChars}, {@code pattern}, {@code min},
 * {@code max}, {@code mimeTypes}) are editor rules (M33): an editor's inline overrides
 * ({@code required level warning scope [release]}) set their severity, scopes, message and
 * {@code onGeneration}; without overrides they are {@code ERROR} in edit, release and generation, as before.
 * {@link #withUiLanguage} picks the language of an author's message.
 */
public final class ContentValidator {

    private static final Set<String> LINK_KINDS = Set.of("INTERNAL", "EXTERNAL", "MEDIA", "ANCHOR", "MAIL");

    private final ExpressionEvaluator evaluator;
    private final RecordDatasetLookup recordDatasets;
    private final PaginationSourceLookup paginationSources;
    private final LocalizationContext localization;
    private final String uiLanguage;

    /** Creates a validator with a fresh expression evaluator. */
    public ContentValidator() {
        this(new ExpressionEvaluator());
    }

    /** Creates a validator backed by the supplied evaluator (useful in tests). */
    public ContentValidator(ExpressionEvaluator evaluator) {
        this(evaluator, null);
    }

    /**
     * Creates a validator that also checks dataset membership of references restricted with
     * {@code dataset "uid"} through {@code recordDatasets} (M19.3.2); {@code null} checks only that
     * such a reference points at a record.
     */
    public ContentValidator(ExpressionEvaluator evaluator, RecordDatasetLookup recordDatasets) {
        this(evaluator, recordDatasets, null);
    }

    /**
     * Creates a validator that also checks a pagination value's source through {@code paginationSources} (M21.1.1):
     * a live navigation folder or dataset, and a dataset sort key the schema declares. {@code null} checks the
     * value's shape and its editor's declaration only.
     */
    public ContentValidator(
            ExpressionEvaluator evaluator, RecordDatasetLookup recordDatasets, PaginationSourceLookup paginationSources) {
        this(evaluator, recordDatasets, paginationSources, LocalizationContext.NONE);
    }

    /**
     * Creates a validator that also enforces the M24 locale rules: a {@code localizable} editor's
     * value must be an L10N wrapper, each locale's value is checked against the editor's own
     * rules, and {@code required} applies to the default locale only. {@link LocalizationContext#NONE}
     * leaves {@code localizable} inactive, which is what a single-language project wants.
     */
    public ContentValidator(
            ExpressionEvaluator evaluator,
            RecordDatasetLookup recordDatasets,
            PaginationSourceLookup paginationSources,
            LocalizationContext localization) {
        this(evaluator, recordDatasets, paginationSources, localization, null);
    }

    private ContentValidator(
            ExpressionEvaluator evaluator,
            RecordDatasetLookup recordDatasets,
            PaginationSourceLookup paginationSources,
            LocalizationContext localization,
            String uiLanguage) {
        this.evaluator = evaluator;
        this.recordDatasets = recordDatasets;
        this.paginationSources = paginationSources;
        this.localization = localization == null ? LocalizationContext.NONE : localization;
        this.uiLanguage = uiLanguage;
    }

    /** This validator, resolving author messages for {@code language} (a UI language tag; {@code null}: the first entry). */
    public ContentValidator withUiLanguage(String language) {
        return new ContentValidator(evaluator, recordDatasets, paginationSources, localization, language);
    }

    /** The locales this validator knows about (M24), for the rule engine. */
    public LocalizationContext localization() {
        return localization;
    }

    /** The UI language author messages resolve for; {@code null} for the first entry. */
    public String uiLanguage() {
        return uiLanguage;
    }

    /** The {@code visibleWhen} evaluator, shared with the rule engine so both agree on what is hidden. */
    public ExpressionEvaluator evaluator() {
        return evaluator;
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
        // `visibleWhen` reads plain values, so expressions see the default locale's resolution
        // rather than the wrappers themselves (the Angular form engine uses the editing locale).
        JsonNode scope = localization.localized()
                ? L10nValues.resolveDeep(root, List.of(localization.defaultLocale()))
                : root;
        validateEditors(definition.editors(), scope, root, pathPrefix, sections, issues);
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
            } else if (editor.isPagination()) {
                validatePagination(editor, value, path, issues);
            } else {
                validateLeaf(editor, value, path, issues);
            }
        }
    }

    /**
     * A leaf editor's value. When the editor is {@code localizable} and the project has locales,
     * the stored value is an L10N wrapper: each present locale is validated on its own, and
     * {@code required} is enforced for the default locale only — every other locale may be empty
     * and resolve through its fallback chain (M24.2.1).
     */
    private void validateLeaf(EditorDefinition editor, JsonNode value, String path, List<ContentIssue> issues) {
        if (!editor.localizable() || !localization.localized()) {
            // `localizable` is inactive in a single-language project, and a non-localizable editor
            // never holds a wrapper — either way a wrapper here is a malformed value.
            if (L10nValues.isL10n(value)) {
                issues.add(new ContentIssue(
                        path, "type", Severity.ERROR,
                        "Editor '" + editor.name() + "' is not language-dependent and must hold a plain value."));
                return;
            }
            validateScalar(editor, value, path, issues);
            return;
        }

        String defaultLocale = localization.defaultLocale();
        boolean absent = value == null || value.isNull() || value.isMissingNode();
        if (!absent && !L10nValues.isL10n(value)) {
            issues.add(new ContentIssue(
                    path, "type", Severity.ERROR,
                    "Editor '" + editor.name() + "' is language-dependent and must hold a value per language."));
            return;
        }
        if (editor.required() && isEmpty(editor.type(), L10nValues.get(value, defaultLocale))) {
            issues.add(builtin(editor, path + ".values." + defaultLocale, "required",
                    "Required editor '" + editor.name() + "' is empty in the default language.", Map.of())
                    .withLocale(defaultLocale));
        }
        if (absent) {
            return;
        }
        for (String locale : L10nValues.locales(value)) {
            String localePath = path + ".values." + locale;
            if (!localization.declares(locale)) {
                issues.add(new ContentIssue(
                        localePath, "locale", Severity.WARNING,
                        "Editor '" + editor.name() + "' has a value for '" + locale
                                + "', which this project no longer lists as a language. The value is kept."));
            }
            List<ContentIssue> localeIssues = new ArrayList<>();
            validateScalarValue(editor, L10nValues.get(value, locale), localePath, localeIssues);
            localeIssues.forEach(issue -> issues.add(issue.withLocale(locale)));
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
        if (editor.required() && isEmpty(editor.type(), value)) {
            issues.add(builtin(editor, path, "required", "Required editor '" + editor.name() + "' is empty.", Map.of()));
            return;
        }
        validateScalarValue(editor, value, path, issues);
    }

    /** A leaf value's shape and type rules, without the {@code required} check. */
    private void validateScalarValue(EditorDefinition editor, JsonNode value, String path, List<ContentIssue> issues) {
        if (isEmpty(editor.type(), value)) {
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
            case REFERENCE -> validateDataset(editor, value, path, issues);
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
            issues.add(builtin(editor, path, "required", "Required editor '" + editor.name() + "' is empty.", Map.of()));
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
            issues.add(builtin(editor, path, "required", "Required editor '" + editor.name() + "' is empty.", Map.of()));
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

    /**
     * A pagination value (M21.1.1): {@code {type:"PAGINATION", source:{kind, uuid}, pageSize, sort:{key, direction}}},
     * or {@code null} for a page that isn't paginated. Findings are structural ({@code type} for a malformed object,
     * {@code pagination} otherwise): a page must never store a source the planner can't count.
     */
    private void validatePagination(EditorDefinition editor, JsonNode value, String path, List<ContentIssue> issues) {
        if (value == null || value.isNull() || value.isMissingNode()) {
            if (editor.required()) {
                issues.add(builtin(editor, path, "required", "Required editor '" + editor.name() + "' is empty.", Map.of()));
            }
            return;
        }
        if (!isPaginationShape(value)) {
            issues.add(new ContentIssue(path, "type", Severity.ERROR, "Editor '" + editor.name() + "' has an invalid value shape."));
            return;
        }
        PaginationOptions options = editor.pagination() != null
                ? editor.pagination()
                : new PaginationOptions(null, PaginationOptions.DEFAULT_PAGE_SIZE, null, null);
        String kind = value.path("source").path("kind").asText();
        UUID uuid = UUID.fromString(value.path("source").path("uuid").asText());
        boolean nav = "NAV".equals(kind);
        if (!(nav || "DATASET".equals(kind)) || !options.allows(kind)) {
            issues.add(new ContentIssue(
                    path + ".source.kind", "pagination", Severity.ERROR,
                    "Editor '" + editor.name() + "' does not allow source kind '" + kind + "' (allowed: "
                            + String.join(", ", options.sources()) + ")."));
            return;
        }
        int pageSize = value.path("pageSize").asInt();
        if (pageSize < 1 || pageSize > options.effectiveMaxPageSize()) {
            issues.add(new ContentIssue(
                    path + ".pageSize", "pagination", Severity.ERROR,
                    "Editor '" + editor.name() + "' needs a page size between 1 and " + options.effectiveMaxPageSize() + "."));
        }
        JsonNode sort = value.get("sort");
        String sortKey = sort == null || sort.isNull() ? null : sort.path("key").asText();
        if (sortKey != null && !options.sort().contains(sortKey)) {
            issues.add(new ContentIssue(
                    path + ".sort.key", "pagination", Severity.ERROR,
                    "Editor '" + editor.name() + "' does not offer sort key '" + sortKey + "'."));
            return;
        }
        if (nav && sortKey != null && !PaginationOptions.NAV_SORT_KEYS.contains(sortKey)) {
            issues.add(new ContentIssue(
                    path + ".sort.key", "pagination", Severity.ERROR,
                    "A navigation source can't sort by '" + sortKey + "': use "
                            + String.join(", ", PaginationOptions.NAV_SORT_KEYS) + "."));
        }
        if (paginationSources == null) {
            return;
        }
        if (nav) {
            if (!paginationSources.isNavigationFolder(uuid)) {
                issues.add(new ContentIssue(
                        path + ".source.uuid", "pagination", Severity.ERROR,
                        "Editor '" + editor.name() + "' must point at a folder of the Navigation store."));
            }
            return;
        }
        Optional<ContentDefinition> schema = paginationSources.datasetSchema(uuid);
        if (schema.isEmpty()) {
            issues.add(new ContentIssue(
                    path + ".source.uuid", "pagination", Severity.ERROR,
                    "Editor '" + editor.name() + "' must point at a dataset."));
        } else if (sortKey != null && !isSortableField(schema.get(), sortKey)) {
            issues.add(new ContentIssue(
                    path + ".sort.key", "pagination", Severity.ERROR,
                    "The dataset has no sortable field '" + sortKey + "'."));
        }
    }

    /** {@code type}, a {@code source} with a text {@code kind} and a UUID, an integer {@code pageSize}, an optional {@code sort}. */
    private static boolean isPaginationShape(JsonNode value) {
        JsonNode source = value.path("source");
        if (!isTyped(value, "PAGINATION") || !source.path("kind").isTextual() || !isUuid(source.get("uuid"))
                || !value.path("pageSize").isIntegralNumber()) {
            return false;
        }
        JsonNode sort = value.get("sort");
        if (sort == null || sort.isNull()) {
            return true;
        }
        JsonNode direction = sort.path("direction");
        return sort.isObject()
                && sort.path("key").isTextual()
                && (direction.isMissingNode() || direction.isNull()
                        || "ASC".equals(direction.asText()) || "DESC".equals(direction.asText()));
    }

    /** A record meta field, or a declared editor with a natural order (the dataset loop's sort rule, M19.3.1). */
    private static boolean isSortableField(ContentDefinition schema, String field) {
        return RecordView.META_FIELDS.contains(field)
                || schema.findEditor(field).map(editor -> DatasetQueryParser.SCALAR_TYPES.contains(editor.type())).orElse(false);
    }

    private void validateTextConstraints(
            EditorDefinition editor, String text, String path, List<ContentIssue> issues) {
        int length = text == null ? 0 : text.length();
        if (editor.maxLength() != null && length > editor.maxLength()) {
            issues.add(builtin(editor, path, "maxLength",
                    "Editor '" + editor.name() + "' exceeds the maximum length of " + editor.maxLength() + ".",
                    Map.of("max", String.valueOf(editor.maxLength()), "length", String.valueOf(length), "value", text)));
        }
        if (editor.maxChars() != null && length > editor.maxChars()) {
            issues.add(builtin(editor, path, "maxChars",
                    "Editor '" + editor.name() + "' exceeds the maximum of " + editor.maxChars() + " characters.",
                    Map.of("max", String.valueOf(editor.maxChars()), "length", String.valueOf(length), "value", text)));
        }
        if (editor.pattern() != null) {
            try {
                if (!text.matches(editor.pattern())) {
                    issues.add(builtin(editor, path, "pattern", defaultPatternMessage(editor), Map.of("value", text)));
                }
            } catch (java.util.regex.PatternSyntaxException e) {
                issues.add(new ContentIssue(path, "pattern", Severity.WARNING, "Invalid pattern: " + e.getMessage()));
            }
        }
    }

    private void validateNumberBounds(EditorDefinition editor, JsonNode value, String path, List<ContentIssue> issues) {
        double number = value.asDouble();
        if (editor.min() != null && number < editor.min()) {
            issues.add(builtin(editor, path, "min", "Editor '" + editor.name() + "' must be at least " + editor.min() + ".",
                    Map.of("min", String.valueOf(editor.min()), "value", value.asText())));
        }
        if (editor.max() != null && number > editor.max()) {
            issues.add(builtin(editor, path, "max", "Editor '" + editor.name() + "' must be at most " + editor.max() + ".",
                    Map.of("max", String.valueOf(editor.max()), "value", value.asText())));
        }
    }

    private void validateListBounds(EditorDefinition editor, int count, String path, List<ContentIssue> issues) {
        if (editor.min() != null && count < editor.min()) {
            issues.add(builtin(editor, path, "min", "Editor '" + editor.name() + "' requires at least " + editor.min() + " items.",
                    Map.of("min", String.valueOf(editor.min()), "length", String.valueOf(count))));
        }
        if (editor.max() != null && count > editor.max()) {
            issues.add(builtin(editor, path, "max", "Editor '" + editor.name() + "' allows at most " + editor.max() + " items.",
                    Map.of("max", String.valueOf(editor.max()), "length", String.valueOf(count))));
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

    private void validateMime(EditorDefinition editor, JsonNode value, String path, List<ContentIssue> issues) {
        if (editor.mimeTypes().isEmpty()) {
            return;
        }
        String mime = mimeOf(value);
        if (mime == null) {
            return;
        }
        if (!editor.mimeTypes().contains(mime)) {
            issues.add(builtin(editor, path, "mimeType",
                    "Editor '" + editor.name() + "' has a mime type '" + mime + "' that is not allowed.", Map.of("value", mime)));
        }
    }

    /**
     * A reference restricted with {@code dataset "uid"} must point at a record of that dataset — or, when its
     * {@code assetTypes} allow {@code RECORD_SET}, at a record set of that dataset (M25.2.2). A record or set of
     * another dataset (or any other asset type) is a structural {@code dataset} finding, the same as a value
     * outside a select's options. Records stay allowed when {@code assetTypes} is empty or names {@code RECORD}.
     */
    private void validateDataset(EditorDefinition editor, JsonNode value, String path, List<ContentIssue> issues) {
        String dataset = editor.dataset();
        if (dataset == null || dataset.isBlank()) {
            return;
        }
        boolean records = editor.assetTypes().isEmpty() || editor.assetTypes().contains("RECORD");
        boolean sets = editor.assetTypes().contains("RECORD_SET");
        String targets = records && sets ? "a record or record set" : sets ? "a record set" : "a record";
        String message = "Editor '" + editor.name() + "' must reference " + targets + " of dataset '" + dataset + "'.";
        JsonNode assetType = value.get("assetType");
        if (assetType != null && assetType.isTextual()) {
            String type = assetType.asText().toUpperCase(java.util.Locale.ROOT);
            boolean allowed = (records && "RECORD".equals(type)) || (sets && "RECORD_SET".equals(type));
            if (!allowed) {
                issues.add(new ContentIssue(path, "dataset", Severity.ERROR, message));
                return;
            }
        }
        if (recordDatasets != null) {
            UUID target = UUID.fromString(value.get("uuid").asText());
            if (!recordDatasets.datasetUidOf(target).map(dataset::equals).orElse(false)) {
                issues.add(new ContentIssue(path, "dataset", Severity.ERROR, message));
            }
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

    private static String defaultPatternMessage(EditorDefinition editor) {
        return "Editor '" + editor.name() + "' does not match the expected pattern.";
    }

    /**
     * A built-in completeness finding with the editor's overrides (M33): severity from {@code level} (default
     * {@code ERROR}), its {@code scopes} (default edit, release, generation), its author message resolved for the UI
     * language with {@code values} as placeholders (default {@code defaultMessage}), and {@code onGeneration}.
     *
     * @param code the finding code; {@code mimeType} is the {@code mimeTypes} built-in
     */
    private ContentIssue builtin(
            EditorDefinition editor, String path, String code, String defaultMessage, Map<String, String> values) {
        BuiltinRule rule = editor.builtinRule("mimeType".equals(code) ? "mimeTypes" : code);
        Severity severity = rule.level() != null ? Severity.of(rule.level()) : Severity.ERROR;
        Set<RuleScope> scopes = rule.scopes() != null ? rule.scopes() : ContentIssue.DEFAULT_SCOPES;
        RuleMessages messages = rule.messages();
        String message = messages.isEmpty() ? defaultMessage : RuleMessages.fill(messages.resolve(uiLanguage), values);
        return new ContentIssue(path, code, severity, message, ContentIssue.Kind.COMPLETENESS, code, scopes,
                messages.byLanguage(), null, rule.onGeneration());
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
            case PAGINATION -> isTyped(value, "PAGINATION");
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
     * Whether {@code value} counts as "not filled in" for an editor of {@code type} — the {@code required} check's
     * notion, shared with the rule engine's {@code requiredWhen} (M33): absent/null,
     * blank text, an empty array or object, or the placeholder the form engine stores for an
     * untouched object editor — a MEDIA/REFERENCE ref without a {@code uuid}, a LINK without a
     * {@code uuid}/{@code url}/{@code anchor} (and no unknown {@code kind}), a RICHTEXT with a blank {@code value}, a CATALOG
     * without cards. A value of the wrong shape is never empty, so it still fails the shape check.
     */
    public static boolean isEmptyValue(EditorType type, JsonNode value) {
        return isEmpty(type, value);
    }

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
