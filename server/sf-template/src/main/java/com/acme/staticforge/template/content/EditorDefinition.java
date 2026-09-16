package com.acme.staticforge.template.content;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.List;

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
        List<EditorDefinition> items,
        /** For REFERENCE editors (M19.3.2): restricts picking to records of this dataset UID; {@code null} for none. */
        String dataset,
        /** For PAGINATION editors (M21.1.1): sources, page size and sort keys; {@code null} for every other type. */
        PaginationOptions pagination) {

    public EditorDefinition {
        items = items == null ? List.of() : items;
        mimeTypes = mimeTypes == null ? List.of() : mimeTypes;
        assetTypes = assetTypes == null ? List.of() : assetTypes;
        options = options == null ? List.of() : options;
        features = features == null ? List.of() : features;
        allow = allow == null ? List.of() : allow;
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
}
