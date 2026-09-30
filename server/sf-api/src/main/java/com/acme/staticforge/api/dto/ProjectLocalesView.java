package com.acme.staticforge.api.dto;

import java.util.List;
import java.util.Map;

/**
 * A project's content locale configuration as returned by
 * {@code GET/PUT /api/v1/projects/{key}/locales} (M24, spec §20.2).
 *
 * @param urlsWillChange set on a {@code PUT} response when the edit changes generated
 *     output paths (locales enabled/disabled, or the prefix setting flipped)
 * @param removedLocales locales dropped by this edit; their stored values are kept
 * @param retainedValueCount how many stored values still exist for {@code removedLocales}
 * @param confirmationRequired {@code true} when the request was <em>not</em> applied because it
 *     would discard translations; re-send with {@code ?confirmDiscard=true} to go ahead
 * @param discardedLocaleValues how many translations the change discards
 * @param affectedAssets the assets whose content the change rewrites
 * @param warnings on a {@code PUT} response: the page template channels whose output path lacks {@code {locale}} now that
 *     the project has languages (the first {@value #MAX_WARNINGS}, by template name); the save is not blocked by them
 * @param warningCount how many there are in all
 */
public record ProjectLocalesView(
        List<ProjectLocaleView> locales,
        String defaultLocale,
        Map<String, List<String>> fallbacks,
        boolean defaultWithoutPrefix,
        boolean urlsWillChange,
        List<String> removedLocales,
        int retainedValueCount,
        boolean confirmationRequired,
        int discardedLocaleValues,
        List<String> affectedAssets,
        List<LocaleWarningView> warnings,
        int warningCount) {

    /** How many warnings a response lists. */
    public static final int MAX_WARNINGS = 50;

    /** One declared locale: a canonical BCP 47 tag and the label shown to editors. */
    public record ProjectLocaleView(String code, String label) {}
}
