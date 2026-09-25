package com.acme.staticforge.release;

import com.acme.staticforge.asset.AssetType;
import com.acme.staticforge.asset.media.MediaFiles;
import com.acme.staticforge.project.LocaleConfig;
import com.fasterxml.jackson.databind.JsonNode;
import java.util.List;

/**
 * The locale keys an asset is released under (M27.1.1, epic decision 4).
 *
 * <p>A project without locales, and media that isn't localized, have the single key {@link #ALL}: one pointer that
 * every locale renders. Every other releasable asset of a localized project has one key per declared locale, so each
 * locale can be released on its own.
 */
public final class ReleaseLocales {

    /** The locale key of a pointer that applies to every locale. */
    public static final String ALL = "";

    private ReleaseLocales() {}

    /** The locale keys of an asset of {@code type} with the given open {@code payload}. */
    public static List<String> keysFor(LocaleConfig config, AssetType type, JsonNode payload) {
        LocaleConfig locales = LocaleConfig.orEmpty(config);
        if (!locales.isLocalized()) {
            return List.of(ALL);
        }
        if (type == AssetType.MEDIA && !isLocalizedMedia(payload)) {
            return List.of(ALL);
        }
        return locales.codes();
    }

    /**
     * {@code true} for a media asset flagged {@code localized} (M27.3.1). Read defensively: a payload without the
     * flag — every media before M27.3.1 — is not localized.
     */
    public static boolean isLocalizedMedia(JsonNode payload) {
        return MediaFiles.isLocalized(payload);
    }
}
