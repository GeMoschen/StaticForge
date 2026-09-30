package com.acme.staticforge.asset.template;

import com.acme.staticforge.template.cdl.CdlSources;
import java.util.Map;

/**
 * Command to update an existing section or page template (spec §12.1, §13.2). Mirrors
 * {@link CreateTemplateCommand} without the immutable project/kind identity; the CDL sections (M34) and
 * per-channel OCTL sources replace the previous values and are recompiled on save. {@code paginationPath} (M21.2.1)
 * replaces the stored pattern map like {@code outputPath} does.
 */
public record UpdateTemplateCommand(
        String displayName,
        CdlSources cdl,
        Map<String, String> channelSources,
        String category,
        boolean deprecated,
        Map<String, String> outputPath,
        boolean abstractTemplate,
        Map<String, String> paginationPath) {

    public UpdateTemplateCommand {
        cdl = cdl == null ? CdlSources.EMPTY : cdl;
        channelSources = channelSources == null ? Map.of() : channelSources;
        outputPath = outputPath == null ? Map.of() : outputPath;
        paginationPath = paginationPath == null ? Map.of() : paginationPath;
    }

    /** A template without pagination path patterns, the only kind before M21. */
    public UpdateTemplateCommand(
            String displayName,
            CdlSources cdl,
            Map<String, String> channelSources,
            String category,
            boolean deprecated,
            Map<String, String> outputPath,
            boolean abstractTemplate) {
        this(displayName, cdl, channelSources, category, deprecated, outputPath, abstractTemplate, Map.of());
    }

    /** A concrete (non-abstract) template, the only kind before M20. */
    public UpdateTemplateCommand(
            String displayName,
            CdlSources cdl,
            Map<String, String> channelSources,
            String category,
            boolean deprecated,
            Map<String, String> outputPath) {
        this(displayName, cdl, channelSources, category, deprecated, outputPath, false);
    }
}
