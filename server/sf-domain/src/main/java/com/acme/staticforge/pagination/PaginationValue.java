package com.acme.staticforge.pagination;

import com.acme.staticforge.template.content.ContentDefinition;
import com.acme.staticforge.template.content.EditorDefinition;
import com.acme.staticforge.template.content.PaginationOptions;
import com.fasterxml.jackson.databind.JsonNode;
import java.util.Optional;
import java.util.UUID;

/**
 * A page's stored pagination choice (M21.1.1) as the planner, generation and preview read it: the value of the page
 * template's one {@code pagination} editor, {@code {type:"PAGINATION", source:{kind, uuid}, pageSize, sort:{key,
 * direction}}}.
 *
 * @param sortKey the chosen sort key; the editor's first offered key when the value has none
 * @param descending whether the primary sort key runs descending
 */
public record PaginationValue(String editorName, Kind kind, UUID sourceUuid, int pageSize, String sortKey, boolean descending) {

    /** The source kinds, as stored. */
    public enum Kind {
        NAV,
        DATASET
    }

    /**
     * The pagination of a page with {@code content} whose template's effective definition is {@code definition}.
     * Empty when the template declares no pagination editor, the value is unset, or it is malformed (the save path
     * rejects malformed values, so that only happens for content written around it): the page renders once.
     */
    public static Optional<PaginationValue> of(ContentDefinition definition, JsonNode content) {
        if (definition == null || content == null || !content.isObject()) {
            return Optional.empty();
        }
        return editorOf(definition).flatMap(editor -> parse(editor, content.get(editor.name())));
    }

    /** The definition's pagination editor; groups are transparent, list items are not (they can't hold one). */
    public static Optional<EditorDefinition> editorOf(ContentDefinition definition) {
        for (EditorDefinition editor : definition.editors()) {
            if (editor.isPagination()) {
                return Optional.of(editor);
            }
            if (editor.isGroup()) {
                Optional<EditorDefinition> nested = editorOf(new ContentDefinition(editor.items(), null));
                if (nested.isPresent()) {
                    return nested;
                }
            }
        }
        return Optional.empty();
    }

    private static Optional<PaginationValue> parse(EditorDefinition editor, JsonNode value) {
        if (value == null || !value.isObject() || !"PAGINATION".equals(value.path("type").asText())) {
            return Optional.empty();
        }
        Kind kind;
        UUID source;
        try {
            kind = Kind.valueOf(value.path("source").path("kind").asText());
            source = UUID.fromString(value.path("source").path("uuid").asText());
        } catch (IllegalArgumentException e) {
            return Optional.empty();
        }
        int pageSize = value.path("pageSize").asInt(0);
        if (pageSize < 1) {
            return Optional.empty();
        }
        PaginationOptions options = editor.pagination();
        JsonNode sort = value.path("sort");
        String sortKey = sort.path("key").isTextual() && !sort.path("key").asText().isBlank()
                ? sort.path("key").asText()
                : options == null || options.sort().isEmpty() ? null : options.sort().get(0);
        if (sortKey == null) {
            sortKey = kind == Kind.NAV ? "navigation" : "_displayName";
        }
        return Optional.of(new PaginationValue(
                editor.name(), kind, source, pageSize, sortKey, "DESC".equals(sort.path("direction").asText())));
    }
}
