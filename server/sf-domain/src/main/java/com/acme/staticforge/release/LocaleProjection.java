package com.acme.staticforge.release;

import com.acme.staticforge.asset.AssetVersion;
import com.acme.staticforge.asset.media.MediaFiles;
import com.acme.staticforge.common.L10nValues;
import com.acme.staticforge.project.LocaleConfig;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.fasterxml.jackson.databind.node.TextNode;
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
 * <p>A localized media payload (M27.3.1) projects, instead of its files, the one file the locale renders
 * ({@link MediaFiles#fileFor}) and the locale that owns it — so replacing only the French file changes only the
 * French projection, and a locale that starts to have its own file changes even when the bytes are the same (it is
 * published at another path). The version's MIME type column describes the default file only and is left out.
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
                        version.getPayload(),
                        version.getFolderId()),
                localeKey,
                config);
    }

    /** The projection of {@code input} for {@code localeKey}. */
    public static JsonNode project(Input input, String localeKey, LocaleConfig config) {
        ObjectNode out = JsonNodeFactory.instance.objectNode();
        out.put("uid", input.uid());
        out.put("displayName", input.displayName());
        out.put("folderPath", input.folderPath());
        // The parent itself, not only its path: a record moved to another record set of the same folder keeps its
        // folder path but renders in the other set (M27.2.1).
        if (input.folderId() != null) {
            out.put("folderId", input.folderId());
        }
        if (input.templateAssetId() != null) {
            out.put("templateAssetId", input.templateAssetId());
        }
        out.put("deleted", input.deleted());
        boolean perLocaleFile = !ReleaseLocales.ALL.equals(localeKey)
                && MediaFiles.isLocalized(input.payload())
                && LocaleConfig.orEmpty(config).isLocalized();
        if (input.mimeType() != null && !perLocaleFile) {
            out.put("mimeType", input.mimeType());
        }
        out.set("payload", projectPayload(
                perLocaleFile ? withLocaleFile(input.payload(), localeKey, config) : input.payload(), localeKey, config));
        return out;
    }

    /** A localized media payload with its files replaced by the one {@code locale} renders and that file's owner. */
    private static JsonNode withLocaleFile(JsonNode payload, String locale, LocaleConfig config) {
        MediaFiles.Resolved resolved = MediaFiles.fileFor(payload, locale, config.effectiveChain(locale));
        ObjectNode out = ((ObjectNode) payload).deepCopy();
        MediaFiles.FILE_FIELDS.forEach(out::remove);
        out.remove(MediaFiles.LOCALE_FILES);
        out.remove(MediaFiles.FILE_LOCALE);
        out.set("file", resolved.file());
        out.set("fileOwner", resolved.locale() == null ? JsonNodeFactory.instance.nullNode() : TextNode.valueOf(resolved.locale()));
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
            JsonNode payload,
            Long folderId) {

        /** An input without a parent id (tests that don't place the asset). */
        public Input(
                String uid,
                String displayName,
                String folderPath,
                Long templateAssetId,
                boolean deleted,
                String mimeType,
                JsonNode payload) {
            this(uid, displayName, folderPath, templateAssetId, deleted, mimeType, payload, null);
        }
    }
}
