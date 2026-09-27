package com.acme.staticforge.exportimport;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.List;

/**
 * The {@code settings.json} archive entry payload (feature `selective-export`, `M10.1.2`):
 * project-level configuration that lives outside the asset/revision system. Written only
 * when {@link ExportSelection#includeChannels()} and/or {@link
 * ExportSelection#includeGenerationTargets()} is set; each list is populated per its own
 * flag, independent of the other, and both are always non-null (possibly empty) so the
 * payload round-trips through JSON without null-handling on either side.
 *
 * <p>{@code locales} is the project's content language configuration (M24.5.1). It is absent from
 * archives written before M24 and reads back as {@code null}, which means "this archive says nothing
 * about languages" — never "this project has none".
 *
 * <p>{@code qualityRules} is the project's quality rule configuration (M30.1.2, protocol {@code 10}) as the project
 * stores it; {@code null} when every rule is at its default, and in every archive written before M30.
 */
public record ExportedSettings(
        List<ExportedChannel> channels,
        List<ExportedGenerationTarget> targets,
        com.acme.staticforge.project.LocaleConfig locales,
        JsonNode qualityRules) {

    /** Settings without a quality rule configuration — every archive written before M30. */
    public ExportedSettings(
            List<ExportedChannel> channels,
            List<ExportedGenerationTarget> targets,
            com.acme.staticforge.project.LocaleConfig locales) {
        this(channels, targets, locales, null);
    }

    /** Settings without a language configuration — every archive written before M24. */
    public ExportedSettings(List<ExportedChannel> channels, List<ExportedGenerationTarget> targets) {
        this(channels, targets, null, null);
    }
}
