package com.acme.staticforge.asset.localization;

import java.util.List;
import java.util.UUID;

/**
 * How complete one asset's translations are (M24.4.2).
 *
 * <p>A field counts as <em>missing</em> in a language when the default language has a value and that
 * language does not — a value the reader will see, but only because it falls through from another
 * language. Inherited is not translated: that is the whole point of the indicator.
 *
 * @param assetUuid the page, global set or record the status is about
 * @param locales one entry per declared language, in the project's order
 * @param orphaned languages the asset still holds values for that the project no longer declares
 */
public record TranslationStatus(UUID assetUuid, List<LocaleStatus> locales, List<String> orphaned) {

    /** An asset in a project without languages: nothing to translate, nothing to report. */
    public static TranslationStatus none(UUID assetUuid) {
        return new TranslationStatus(assetUuid, List.of(), List.of());
    }

    public TranslationStatus {
        locales = locales == null ? List.of() : List.copyOf(locales);
        orphaned = orphaned == null ? List.of() : List.copyOf(orphaned);
    }

    /** Whether any declared language is missing a translation. */
    public boolean incomplete() {
        return locales.stream().anyMatch(locale -> locale.missing() > 0);
    }

    /** How complete one language is.
     *
     * @param total language-dependent fields that have a default-language value — the denominator
     * @param missing how many of those this language has no value of its own for
     */
    public record LocaleStatus(String locale, int missing, int total) {

        public boolean complete() {
            return missing == 0;
        }
    }
}
