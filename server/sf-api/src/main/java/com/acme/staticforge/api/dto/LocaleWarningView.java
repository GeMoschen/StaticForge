package com.acme.staticforge.api.dto;

import java.util.UUID;

/**
 * A warning of a language setup save (M35.1): page template {@code templateName} ({@code templateUid},
 * {@code templateUuid}) has the output path {@code outputPath} for {@code channel}, which lacks {@code {locale}} — a
 * build fails ({@code SF-GEN-0111}) because the languages would overwrite each other. {@code code} is
 * {@code SF-GEN-0112}; {@code message} the text of the template's own warning.
 */
public record LocaleWarningView(
        String code,
        String message,
        UUID templateUuid,
        String templateUid,
        String templateName,
        String channel,
        String outputPath) {}
