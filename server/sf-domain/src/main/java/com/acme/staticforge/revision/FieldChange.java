package com.acme.staticforge.revision;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.databind.JsonNode;
import java.util.List;

/**
 * A single field-level change in a structural diff (spec §7.6). Non-richtext leaf/array changes
 * carry only {@code path}/{@code before}/{@code after}; rich-text fields additionally populate
 * {@link #blocks()} with the per-block difference so the UI can render block-level edits.
 */
public record FieldChange(
        String path,
        JsonNode before,
        JsonNode after,
        @JsonInclude(JsonInclude.Include.NON_NULL) List<BlockChange> blocks) {

    /** Non-richtext constructor — {@code blocks} is null and omitted from the serialized output. */
    public FieldChange(String path, JsonNode before, JsonNode after) {
        this(path, before, after, null);
    }

    public boolean isAdd() {
        return before == null || before.isNull();
    }

    public boolean isRemove() {
        return after == null || after.isNull();
    }
}
