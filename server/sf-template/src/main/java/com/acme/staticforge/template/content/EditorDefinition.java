package com.acme.staticforge.template.content;

import com.acme.staticforge.template.rules.BuiltinRule;
import com.fasterxml.jackson.databind.JsonNode;
import java.util.List;
import java.util.Map;

/**
 * A single declared editor in a content definition (spec §14.2–§14.4). The normalized
 * JSON AST the CDL compiler emits; consumed by the content validator and the OCTL
 * renderer's scope resolution.
 */
public record EditorDefinition(
        String name,
        EditorType type,
        String label,
        String help,
        boolean required,
        boolean readOnly,
        boolean hidden,
        JsonNode defaultValue,
        Integer min,
        Integer max,
        Integer maxLength,
        Integer maxChars,
        String pattern,
        String patternMessage,
        List<String> mimeTypes,
        List<String> assetTypes,
        List<SelectOption> options,
        List<String> features,
        /** For CATALOG editors: restricts cards to these section-template UIDs (empty/`["*"]` allows any). */
        List<String> allow,
        String visibleWhen,
        String renamedFrom,
        /**
         * Language-dependent editor (M24): the stored value is an
         * {@code {"type":"L10N","values":{…}}} wrapper holding one value per project locale
         * instead of a bare value. Only leaf editors may set it; {@code group}, {@code list},
         * {@code catalog} and {@code pagination} are structural and shared by all locales.
         */
        boolean localizable,
        List<EditorDefinition> items,
        /** For REFERENCE editors (M19.3.2): restricts picking to records of this dataset UID; {@code null} for none. */
        String dataset,
        /** For PAGINATION editors (M21.1.1): sources, page size and sort keys; {@code null} for every other type. */
        PaginationOptions pagination,
        /**
         * Inline overrides of the built-in checks written on this editor's attributes (M33): built-in name
         * ({@link BuiltinRule#NAMES}) → level, scopes, {@code onGeneration} and messages. Absent names keep the
         * built-in's defaults.
         */
        Map<String, BuiltinRule> builtinRules) {

    /** An editor without built-in overrides. */
    public EditorDefinition(
            String name,
            EditorType type,
            String label,
            String help,
            boolean required,
            boolean readOnly,
            boolean hidden,
            JsonNode defaultValue,
            Integer min,
            Integer max,
            Integer maxLength,
            Integer maxChars,
            String pattern,
            String patternMessage,
            List<String> mimeTypes,
            List<String> assetTypes,
            List<SelectOption> options,
            List<String> features,
            List<String> allow,
            String visibleWhen,
            String renamedFrom,
            boolean localizable,
            List<EditorDefinition> items,
            String dataset,
            PaginationOptions pagination) {
        this(name, type, label, help, required, readOnly, hidden, defaultValue, min, max, maxLength, maxChars, pattern,
                patternMessage, mimeTypes, assetTypes, options, features, allow, visibleWhen, renamedFrom, localizable,
                items, dataset, pagination, Map.of());
    }

    public EditorDefinition {
        builtinRules = builtinRules == null ? Map.of() : Map.copyOf(builtinRules);
        items = items == null ? List.of() : items;
        mimeTypes = mimeTypes == null ? List.of() : mimeTypes;
        assetTypes = assetTypes == null ? List.of() : assetTypes;
        options = options == null ? List.of() : options;
        features = features == null ? List.of() : features;
        allow = allow == null ? List.of() : allow;
    }

    /** The overrides of built-in {@code name}, or its defaults when it has none. */
    public BuiltinRule builtinRule(String name) {
        BuiltinRule rule = builtinRules.get(name);
        return rule != null ? rule : BuiltinRule.defaults(name);
    }

    public boolean isGroup() {
        return type == EditorType.GROUP;
    }

    public boolean isList() {
        return type == EditorType.LIST;
    }

    public boolean isCatalog() {
        return type == EditorType.CATALOG;
    }

    public boolean isPagination() {
        return type == EditorType.PAGINATION;
    }

    /** Structural editors are shared by every locale and can never be {@code localizable}. */
    public boolean isContainer() {
        return isGroup() || isList() || isCatalog() || isPagination();
    }
}
