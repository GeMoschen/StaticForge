package com.acme.staticforge.api.dto;

import java.util.List;
import java.util.Map;

/**
 * Body of {@code PUT /api/v1/projects/{key}/locales} (M24). The list is always replaced in
 * full; an empty list turns the project back into a single-language project without
 * deleting any stored translation.
 */
public record ProjectLocalesRequest(
        List<LocaleEntry> locales,
        String defaultLocale,
        Map<String, List<String>> fallbacks,
        boolean defaultWithoutPrefix) {

    /** One declared locale; {@code label} defaults to the code when blank. */
    public record LocaleEntry(String code, String label) {}
}
