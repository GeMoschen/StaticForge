package com.acme.staticforge.asset.template;

import com.acme.staticforge.asset.AssetType;
import java.util.Map;

/**
 * Command to create a section or page template (spec §12.1, §13.2). The payload is compiled
 * from the CDL source and the per-channel OCTL sources; the compiled definition and hashes
 * are derived server-side rather than accepted from the caller.
 */
public record CreateTemplateCommand(
        long projectId,
        AssetType kind,
        String displayName,
        String contentDefinition,
        Map<String, String> channelSources,
        String category,
        boolean deprecated,
        Map<String, String> outputPath) {

    public CreateTemplateCommand {
        channelSources = channelSources == null ? Map.of() : channelSources;
        outputPath = outputPath == null ? Map.of() : outputPath;
    }
}
