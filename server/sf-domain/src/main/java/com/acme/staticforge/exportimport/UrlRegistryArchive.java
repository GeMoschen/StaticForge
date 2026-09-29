package com.acme.staticforge.exportimport;

import com.acme.staticforge.asset.AssetRepository;
import com.acme.staticforge.project.LocaleConfig;
import com.acme.staticforge.urlregistry.UrlArea;
import com.acme.staticforge.urlregistry.UrlRegistryEntry;
import com.acme.staticforge.urlregistry.UrlRegistryService;
import com.acme.staticforge.urlregistry.UrlTarget;
import com.acme.staticforge.urlregistry.UrlTargetType;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.UUID;
import java.util.function.Function;
import org.springframework.stereotype.Component;

/**
 * The URL registry of an export archive (M32.6, protocol {@code 11}): {@code url-registry.json}, every
 * {@code GENERATED} row of the exported targets — a full export carries the whole registry, a selective one the rows
 * of the assets it picked — so an imported site builds to the same URLs.
 *
 * <p>The import applies the rows after the assets, by the caller's {@link UrlRegistryService.ImportMode}. What it
 * leaves out is reported without blocking: a row whose target already has a manual override
 * ({@link ConflictType#URL_OVERRIDE_KEPT}, mode {@code ARCHIVE_WINS}), a row whose URL another target holds
 * ({@link ConflictType#URL_TAKEN}), and a row that doesn't fit the target project ({@link ConflictType#URL_INVALID}:
 * an unknown channel or language, an asset that isn't there).
 */
@Component
class UrlRegistryArchive {

    private final UrlRegistryService registry;
    private final AssetRepository assets;

    UrlRegistryArchive(UrlRegistryService registry, AssetRepository assets) {
        this.registry = registry;
        this.assets = assets;
    }

    /** The project's {@code GENERATED} rows; only those of {@code targets} unless {@code targets} is {@code null}. */
    List<ExportedUrl> export(long projectId, Set<UUID> targets) {
        List<ExportedUrl> out = new ArrayList<>();
        for (UrlRegistryEntry row : registry.all(projectId, UrlArea.GENERATED)) {
            if (targets != null && !targets.contains(row.getTargetUuid())) {
                continue;
            }
            out.add(new ExportedUrl(row.getTargetType().name(), row.getTargetUuid().toString(), row.getChannelKey(),
                    row.getLocaleKey(), row.getVariantKey(), row.getPageNumber(), row.getUrl(), row.isOverridden()));
        }
        return out;
    }

    /** What an import did with the archive's rows. */
    record Result(int imported, List<ImportConflict> warnings) {}

    /**
     * What an import in {@code mode} would leave out, against the target as it is now. {@code channels} are the channel
     * keys the target will have, {@code locales} its languages, {@code present} whether a target asset will exist.
     */
    List<ImportConflict> analyze(
            long projectId, List<ExportedUrl> archived, UrlRegistryService.ImportMode mode, Set<String> channels,
            LocaleConfig locales, Function<UUID, Boolean> present) {
        return run(projectId, archived, mode, channels, locales, uuid -> uuid, present, true).warnings();
    }

    /**
     * Applies the archive's rows after the import wrote its assets and settings, in the import's transaction.
     * {@code assetUuid} maps an archive asset uuid to the target's (the import re-keys an asset only on a collision).
     */
    Result importAll(
            long projectId, List<ExportedUrl> archived, UrlRegistryService.ImportMode mode, Set<String> channels,
            LocaleConfig locales, Function<UUID, UUID> assetUuid) {
        return run(projectId, archived, mode, channels, locales, assetUuid,
                uuid -> assets.findByProjectIdAndUuid(projectId, uuid).isPresent(), false);
    }

    private Result run(
            long projectId, List<ExportedUrl> archived, UrlRegistryService.ImportMode mode, Set<String> channels,
            LocaleConfig locales, Function<UUID, UUID> assetUuid, Function<UUID, Boolean> present, boolean dryRun) {
        List<ImportConflict> warnings = new ArrayList<>();
        List<UrlRegistryService.ImportedRow> rows = new ArrayList<>();
        List<ExportedUrl> sources = new ArrayList<>();
        for (ExportedUrl url : archived) {
            UrlRegistryService.ImportedRow row;
            try {
                row = normalize(url, channels, locales, assetUuid, present);
            } catch (IllegalArgumentException invalid) {
                warnings.add(ImportConflict.of(ConflictType.URL_INVALID, null, url.label(),
                        "Not imported: " + invalid.getMessage()));
                continue;
            }
            rows.add(row);
            sources.add(url);
        }
        int imported = 0;
        List<UrlRegistryService.ImportResult> results = registry.importRows(projectId, rows, mode, dryRun);
        for (int i = 0; i < results.size(); i++) {
            UrlRegistryService.ImportResult result = results.get(i);
            ExportedUrl source = sources.get(i);
            switch (result.outcome()) {
                case INSERTED, REPLACED -> imported++;
                case KEPT_TARGET_OVERRIDE -> warnings.add(ImportConflict.of(ConflictType.URL_OVERRIDE_KEPT, null,
                        source.label(), "Not imported: the target project's manual URL of this output is kept."));
                case URL_TAKEN -> warnings.add(ImportConflict.of(ConflictType.URL_TAKEN, null, source.label(),
                        "Not imported: the URL already belongs to "
                                + (result.holder() == null ? "another output" : result.holder().describe()) + "."));
                case UNCHANGED, KEPT_TARGET -> {
                    // nothing to report
                }
            }
        }
        return new Result(imported, warnings);
    }

    private static UrlRegistryService.ImportedRow normalize(
            ExportedUrl url, Set<String> channels, LocaleConfig locales, Function<UUID, UUID> assetUuid,
            Function<UUID, Boolean> present) {
        UrlTargetType type;
        UUID uuid;
        try {
            type = UrlTargetType.valueOf(url.targetType().toUpperCase(Locale.ROOT));
            uuid = UUID.fromString(url.targetUuid());
        } catch (RuntimeException e) {
            throw new IllegalArgumentException("it names no valid target.");
        }
        UrlTarget target = new UrlTarget(type, assetUuid.apply(uuid), url.variant(), Math.max(1, url.pageNumber()));
        if (!Boolean.TRUE.equals(present.apply(target.uuid()))) {
            throw new IllegalArgumentException("its asset is not in the target project.");
        }
        String channel = url.channel() == null ? "" : url.channel();
        if (type != UrlTargetType.MEDIA && !channels.contains(channel)) {
            throw new IllegalArgumentException("the channel '" + channel + "' does not exist in the target project.");
        }
        String locale = url.locale() == null ? "" : url.locale();
        if (!locale.isEmpty()) {
            String declared = LocaleConfig.orEmpty(locales).canonicalDeclared(locale);
            if (declared == null) {
                throw new IllegalArgumentException("the language '" + locale + "' does not exist in the target project.");
            }
            locale = declared;
        }
        if (url.url() == null || url.url().isBlank()) {
            throw new IllegalArgumentException("it has no URL.");
        }
        return new UrlRegistryService.ImportedRow(target, channel, UrlArea.GENERATED, locale, url.url(), url.overridden());
    }
}
