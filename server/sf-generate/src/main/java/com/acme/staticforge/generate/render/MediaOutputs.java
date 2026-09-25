package com.acme.staticforge.generate.render;

import com.acme.staticforge.asset.AssetType;
import com.acme.staticforge.asset.media.MediaFiles;
import com.acme.staticforge.asset.media.MediaPaths;
import com.acme.staticforge.generate.snapshot.Snapshot;
import com.acme.staticforge.generate.snapshot.SnapshotAsset;
import com.acme.staticforge.project.LocaleConfig;
import com.fasterxml.jackson.databind.JsonNode;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;

/**
 * Where a media file is published, per render locale (M27.3.2, epic decision 18) — the one rule the renderer's
 * {@code $CMS_REF(media:…)} resolver, the ASSETS stage and carry-forward share, so links and copies agree.
 *
 * <p>Media that isn't localized has one output, {@code assets/media/{uid}.{ext}}, whatever the locale. A localized
 * media file referenced from locale L resolves, in L's view, to the file L renders ({@link MediaFiles#fileFor}):
 * <ul>
 *   <li>L's own file: written under L's prefix ({@link MediaPaths#localePrefix});</li>
 *   <li>a file L falls back to, owned by locale O: the reference links O's output — nothing is written for L — as
 *       long as O publishes its own file (the media is released in O and O owns its file there). What O publishes is
 *       what every locale falling back to O shows;</li>
 *   <li>otherwise (O doesn't publish the media, or no longer has its own file): L writes the file it renders under
 *       its own prefix, so a reference never links a file nobody wrote.</li>
 * </ul>
 * An output is identified by the media and the locale it is written for ({@link Key}); its content always comes from
 * that locale's view. In the draft view every locale sees the same version, so fallbacks always share.
 */
public final class MediaOutputs {

    private final Snapshot snapshot;
    private final LocaleConfig locales;

    public MediaOutputs(Snapshot snapshot, LocaleConfig locales) {
        this.snapshot = snapshot.root();
        this.locales = LocaleConfig.orEmpty(locales);
    }

    /** The snapshot family the outputs are computed from (its root view). */
    public Snapshot snapshot() {
        return snapshot;
    }

    /**
     * The output a reference to {@code mediaUuid} from {@code locale} links; {@code null} when the media is absent from
     * that locale's view (deleted, unreleased, unknown) or isn't media.
     */
    public Output of(UUID mediaUuid, String locale) {
        Snapshot view = snapshot.in(locale);
        SnapshotAsset media = view.assetByUuid(mediaUuid);
        if (!present(media)) {
            return null;
        }
        if (!locales.isLocalized() || !MediaFiles.isLocalized(media.payload())) {
            return new Output(new Key(mediaUuid, null), "", media, media.payload());
        }
        String renderLocale = renderLocale(locale);
        MediaFiles.Resolved resolved = MediaFiles.fileFor(media.payload(), renderLocale, locales.effectiveChain(renderLocale));
        String owner = resolved.locale();
        if (owner != null && !owner.equals(renderLocale)) {
            Output shared = own(mediaUuid, owner);
            if (shared != null) {
                return shared;
            }
        }
        return localeOutput(mediaUuid, renderLocale, media);
    }

    /**
     * Every output a reference to {@code mediaUuid} resolves to from some locale, in locale order: one for media that
     * isn't localized, up to one per locale for localized media. What a plan lists for a processed media file.
     */
    public List<Output> outputsOf(UUID mediaUuid) {
        Map<Key, Output> outputs = new LinkedHashMap<>();
        List<String> referencing = locales.isLocalized() ? locales.codes() : java.util.Collections.singletonList(null);
        for (String locale : referencing) {
            Output output = of(mediaUuid, locale);
            if (output != null) {
                outputs.putIfAbsent(output.key(), output);
            }
        }
        return List.copyOf(outputs.values());
    }

    /** The output {@code key} names, computed from the view of the locale it is written for; {@code null} when absent. */
    public Output of(Key key) {
        if (key.locale() == null) {
            Output output = of(key.media(), null);
            return output != null && output.key().equals(key) ? output : null;
        }
        SnapshotAsset media = snapshot.in(key.locale()).assetByUuid(key.media());
        return present(media) && MediaFiles.isLocalized(media.payload()) ? localeOutput(key.media(), key.locale(), media) : null;
    }

    /** {@code owner}'s output of its own file, or {@code null} when {@code owner} doesn't publish one. */
    private Output own(UUID mediaUuid, String owner) {
        SnapshotAsset media = snapshot.in(owner).assetByUuid(mediaUuid);
        if (!present(media) || !MediaFiles.isLocalized(media.payload())) {
            return null;
        }
        MediaFiles.Resolved resolved = MediaFiles.fileFor(media.payload(), owner, locales.effectiveChain(owner));
        return resolved.own() ? localeOutput(mediaUuid, owner, media) : null;
    }

    private Output localeOutput(UUID mediaUuid, String locale, SnapshotAsset media) {
        JsonNode payload = MediaFiles.effective(media.payload(), locale, locales.effectiveChain(locale));
        return new Output(new Key(mediaUuid, locale), MediaPaths.localePrefix(locales, locale), media, payload);
    }

    /** The declared spelling of {@code locale}; the default locale for {@code null} or an undeclared one. */
    private String renderLocale(String locale) {
        String declared = locale == null ? null : locales.canonicalDeclared(locale);
        return declared != null ? declared : locales.defaultLocale();
    }

    private static boolean present(SnapshotAsset media) {
        return media != null && !media.deleted() && media.type() == AssetType.MEDIA;
    }

    /**
     * Identifies one published media output.
     *
     * @param locale the locale the file is written for; {@code null} for media that isn't localized
     */
    public record Key(UUID media, String locale) {}

    /**
     * One published media file and its variants.
     *
     * @param prefix the locale prefix of its paths ({@code ""} for media that isn't localized)
     * @param asset the media as the output's locale renders it (its uid names the files)
     * @param payload the payload with the output's file in the top-level fields
     */
    public record Output(Key key, String prefix, SnapshotAsset asset, JsonNode payload) {

        /** The primary file's path. */
        public String path() {
            return MediaPaths.localizedMediaPath(prefix, uid(), MediaPaths.extensionFor(mimeType()));
        }

        /** The path of variant {@code name}, or {@code null} when the file has no such variant. */
        public String variantPath(String name) {
            JsonNode variants = payload == null ? null : payload.get("variants");
            if (variants != null && variants.isArray()) {
                for (JsonNode variant : variants) {
                    if (name.equals(variant.path("name").asText())) {
                        return MediaPaths.localizedVariantPath(
                                prefix, uid(), name, extensionForFormat(variant.path("format").asText(null)));
                    }
                }
            }
            return null;
        }

        /** The file's MIME type. */
        public String mimeType() {
            return payload == null ? null : payload.path("mimeType").asText(null);
        }

        /** {@code asset} with the output's file as its payload — what a processed file renders. */
        public SnapshotAsset renderedAsset() {
            return new SnapshotAsset(asset.uuid(), asset.assetId(), asset.type(), asset.uid(), asset.displayName(),
                    asset.folderPath(), payload, asset.deleted(), asset.changedAt(), asset.folderId(), asset.unreleased());
        }

        private String uid() {
            return asset.uid() == null ? "" : asset.uid();
        }
    }

    /** Variant {@code format} ("jpeg") → file extension ("jpg"). */
    public static String extensionForFormat(String format) {
        if (format == null || format.isBlank()) {
            return "bin";
        }
        String value = format.toLowerCase(Locale.ROOT);
        return "jpeg".equals(value) ? "jpg" : value;
    }
}
