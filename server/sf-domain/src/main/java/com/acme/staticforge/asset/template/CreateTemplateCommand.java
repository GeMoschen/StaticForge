package com.acme.staticforge.asset.template;

import com.acme.staticforge.asset.AssetType;
import java.util.Map;
import java.util.UUID;

/**
 * Command to create a section or page template (spec §12.1, §13.2). The payload is compiled
 * from the CDL source and the per-channel OCTL sources; the compiled definition and hashes
 * are derived server-side rather than accepted from the caller. {@code parentFolderUuid} is
 * nullable (spec M13.1.3): when {@code null}, the template lands under the project's fixed
 * folder matching its {@code kind} (the "Page Templates" / "Section Templates" root).
 * {@code abstractTemplate} (M20, page templates only) makes the template a layout pages can't use.
 */
public record CreateTemplateCommand(
        long projectId,
        AssetType kind,
        String displayName,
        String contentDefinition,
        Map<String, String> channelSources,
        String category,
        boolean deprecated,
        Map<String, String> outputPath,
        UUID parentFolderUuid,
        boolean abstractTemplate) {

    public CreateTemplateCommand {
        channelSources = channelSources == null ? Map.of() : channelSources;
        outputPath = outputPath == null ? Map.of() : outputPath;
    }

    /** A concrete (non-abstract) template, the only kind before M20. */
    public CreateTemplateCommand(
            long projectId,
            AssetType kind,
            String displayName,
            String contentDefinition,
            Map<String, String> channelSources,
            String category,
            boolean deprecated,
            Map<String, String> outputPath,
            UUID parentFolderUuid) {
        this(projectId, kind, displayName, contentDefinition, channelSources, category, deprecated, outputPath, parentFolderUuid, false);
    }

    /** Pre-M13.1.3 callers omitting {@code parentFolderUuid}: resolves to the fixed folder matching {@code kind}. */
    public CreateTemplateCommand(
            long projectId,
            AssetType kind,
            String displayName,
            String contentDefinition,
            Map<String, String> channelSources,
            String category,
            boolean deprecated,
            Map<String, String> outputPath) {
        this(projectId, kind, displayName, contentDefinition, channelSources, category, deprecated, outputPath, null, false);
    }
}
