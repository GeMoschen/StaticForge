package com.acme.staticforge.release;

import com.acme.staticforge.asset.AssetVersion;
import com.acme.staticforge.common.L10nValues;
import com.acme.staticforge.project.LocaleConfig;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.List;

/**
 * What one locale renders of an asset version (M27.1.1, epic decision 6): the canonical JSON a release status
 * compares. Two versions that project identically for a locale look the same in that locale, so editing only the
 * English value of a field leaves the German projection — and the German status — untouched.
 *
 * <p>The projection holds the identity and placement a build uses (uid, display name, folder, template, deleted
 * flag, MIME type) and the payload with every L10N wrapper resolved along the locale's fallback chain. A plain value
 * is kept as it is, which makes the read tolerant of both shapes (epic decision 13): a value the M24 localizable
 * toggle wrapped for the default locale projects exactly like the plain value it was.
 *
 * <p>The key {@link ReleaseLocales#ALL} projects the whole payload unresolved, because that pointer stands for every
 * locale at once. Pure: no repository access, safe to cache per (version, locale).
 */
public final class LocaleProjection {

    private LocaleProjection() {}

    /** The projection of {@code version} rendered under {@code uid} for {@code localeKey}. */
    public static JsonNode project(AssetVersion version, String uid, String localeKey, LocaleConfig config) {
        return project(
                new Input(
                        uid,
                        version.getDisplayName(),
                        version.getFolderPath(),
                        version.getTemplateAssetId(),
                        version.isDeleted(),
                        version.getMimeType(),
                        version.getPayload()),
                localeKey,
                config);
    }

    /** The projection of {@code input} for {@code localeKey}. */
    public static JsonNode project(Input input, String localeKey, LocaleConfig config) {
        ObjectNode out = JsonNodeFactory.instance.objectNode();
        out.put("uid", input.uid());
        out.put("displayName", input.displayName());
        out.put("folderPath", input.folderPath());
        if (input.templateAssetId() != null) {
            out.put("templateAssetId", input.templateAssetId());
        }
        out.put("deleted", input.deleted());
        if (input.mimeType() != null) {
            out.put("mimeType", input.mimeType());
        }
        out.set("payload", projectPayload(input.payload(), localeKey, config));
        return out;
    }

    private static JsonNode projectPayload(JsonNode payload, String localeKey, LocaleConfig config) {
        if (payload == null) {
            return JsonNodeFactory.instance.nullNode();
        }
        LocaleConfig locales = LocaleConfig.orEmpty(config);
        if (ReleaseLocales.ALL.equals(localeKey) || !locales.isLocalized()) {
            return payload;
        }
        List<String> chain = locales.effectiveChain(localeKey);
        return L10nValues.resolveDeep(payload, chain);
    }

    /** The version fields a projection reads, for callers that hold no {@link AssetVersion} (tests, previews). */
    public record Input(
            String uid,
            String displayName,
            String folderPath,
            Long templateAssetId,
            boolean deleted,
            String mimeType,
            JsonNode payload) {}
}
