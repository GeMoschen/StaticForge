package com.acme.staticforge.api.dto;

import java.util.List;
import java.util.UUID;

/**
 * How complete one asset's translations are (M24.4.2). Empty {@code locales} means the project has
 * no content languages, and every indicator that reads this stays hidden.
 *
 * @param orphaned languages the asset still holds values for that the project no longer declares
 */
public record TranslationStatusView(UUID assetUuid, List<LocaleStatusView> locales, List<String> orphaned) {

    /**
     * One language's completeness.
     *
     * @param missing fields the default language fills that this language does not
     * @param total fields the default language fills — the denominator of "3 of 12 missing"
     */
    public record LocaleStatusView(String locale, int missing, int total) {}
}
