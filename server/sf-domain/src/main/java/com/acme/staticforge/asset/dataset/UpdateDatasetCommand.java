package com.acme.staticforge.asset.dataset;

import java.util.Map;

/**
 * Command to replace a dataset schema's editable fields (M19.1.2); every field is written as given, except
 * {@code channelTemplates} (M25.2.1): {@code null} keeps the stored record templates (recompiled against the new
 * schema), a map replaces them all — an empty map or a blank source removes a channel's record template.
 */
public record UpdateDatasetCommand(
        String displayName,
        String contentDefinition,
        String titleEditor,
        String description,
        Map<String, String> channelTemplates) {

    /** An update that keeps the stored record templates. */
    public UpdateDatasetCommand(String displayName, String contentDefinition, String titleEditor, String description) {
        this(displayName, contentDefinition, titleEditor, description, null);
    }
}
