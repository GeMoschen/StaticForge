package com.acme.staticforge.asset.template;

import java.util.Map;

/**
 * Command to update an existing section or page template (spec §12.1, §13.2). Mirrors
 * {@link CreateTemplateCommand} without the immutable project/kind identity; the CDL and
 * per-channel OCTL sources replace the previous values and are recompiled on save.
 */
public record UpdateTemplateCommand(
        String displayName,
        String contentDefinition,
        Map<String, String> channelSources,
        String category,
        boolean deprecated,
        Map<String, String> outputPath) {

    public UpdateTemplateCommand {
        channelSources = channelSources == null ? Map.of() : channelSources;
        outputPath = outputPath == null ? Map.of() : outputPath;
    }
}
