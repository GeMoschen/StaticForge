package com.acme.staticforge.release;

import com.acme.staticforge.asset.AssetType;
import com.acme.staticforge.asset.AssetVersion;
import com.acme.staticforge.asset.AssetVersionRepository;
import com.acme.staticforge.project.LocaleConfig;
import com.acme.staticforge.revision.RevisionAware;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.function.Function;
import java.util.stream.Collectors;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

/**
 * Keeps release pointers in step with a change of the project's locale set (M27.1.1, epic decision 4), inside the
 * locale-change revision:
 *
 * <ul>
 *   <li><strong>Locales removed</strong> (the project stays localized): their pointers close. Nothing renders in a
 *       locale the project no longer has.
 *   <li><strong>Locales added</strong> (the project was localized already): no pointers — the new locale is
 *       {@link ReleaseStatus#NEW} everywhere until released.
 *   <li><strong>First locales</strong> (none → some): each {@link ReleaseLocales#ALL} pointer becomes one pointer
 *       per new locale at the same version and uid. It stood for every locale, so the site keeps rendering what it
 *       rendered; non-localized media keeps its {@code ""} pointer.
 *   <li><strong>Last locales removed</strong> (some → none): the default locale's pointer becomes the
 *       {@code ""} pointer, the others close — a single-language project renders the default language.
 * </ul>
 *
 * <p>Carried pointers keep their original author and time: the locale change released nothing new.
 */
@Component
@RevisionAware
public class ReleaseLocaleTransition {

    private final AssetReleaseRepository releaseRepository;
    private final AssetVersionRepository versionRepository;

    public ReleaseLocaleTransition(AssetReleaseRepository releaseRepository, AssetVersionRepository versionRepository) {
        this.releaseRepository = releaseRepository;
        this.versionRepository = versionRepository;
    }

    /** Applies the transition from {@code before} to {@code after} in revision {@code revision}. */
    @Transactional
    public void apply(long projectId, LocaleConfig before, LocaleConfig after, long revision) {
        LocaleConfig from = LocaleConfig.orEmpty(before);
        LocaleConfig to = LocaleConfig.orEmpty(after);
        if (!from.isLocalized() && !to.isLocalized()) {
            return;
        }
        List<AssetRelease> open = releaseRepository.findByProjectIdAndValidToRevisionIsNull(projectId);
        if (open.isEmpty()) {
            return;
        }
        List<AssetRelease> opened = new ArrayList<>();
        if (!from.isLocalized()) {
            spreadToLocales(open, to, revision, opened);
        } else if (!to.isLocalized()) {
            collapseToDefault(open, from.defaultLocale(), revision, opened);
        } else {
            Set<String> kept = new HashSet<>(to.codes());
            for (AssetRelease pointer : open) {
                if (!ReleaseLocales.ALL.equals(pointer.getLocaleKey()) && !kept.contains(pointer.getLocaleKey())) {
                    pointer.setValidToRevision(revision);
                }
            }
        }
        releaseRepository.saveAll(open);
        releaseRepository.saveAll(opened);
    }

    private void spreadToLocales(List<AssetRelease> open, LocaleConfig to, long revision, List<AssetRelease> opened) {
        Map<Long, AssetVersion> versions = versionsOf(open);
        for (AssetRelease pointer : open) {
            if (!ReleaseLocales.ALL.equals(pointer.getLocaleKey())) {
                continue;
            }
            AssetVersion version = versions.get(pointer.getReleasedVersionId());
            AssetType type = version == null ? null : version.getAsset().getAssetType();
            List<String> keys = type == null
                    ? to.codes()
                    : ReleaseLocales.keysFor(to, type, version.getPayload());
            if (keys.equals(List.of(ReleaseLocales.ALL))) {
                continue;
            }
            pointer.setValidToRevision(revision);
            for (String key : keys) {
                opened.add(copy(pointer, key, revision));
            }
        }
    }

    private static void collapseToDefault(
            List<AssetRelease> open, String defaultLocale, long revision, List<AssetRelease> opened) {
        Map<Long, List<AssetRelease>> byAsset = open.stream()
                .filter(p -> !ReleaseLocales.ALL.equals(p.getLocaleKey()))
                .collect(Collectors.groupingBy(AssetRelease::getAssetId, LinkedHashMap::new, Collectors.toList()));
        for (List<AssetRelease> pointers : byAsset.values()) {
            for (AssetRelease pointer : pointers) {
                pointer.setValidToRevision(revision);
                if (pointer.getLocaleKey().equals(defaultLocale)) {
                    opened.add(copy(pointer, ReleaseLocales.ALL, revision));
                }
            }
        }
    }

    private Map<Long, AssetVersion> versionsOf(List<AssetRelease> pointers) {
        Set<Long> ids = pointers.stream().map(AssetRelease::getReleasedVersionId).collect(Collectors.toSet());
        return Chunks.flatMap(ids, versionRepository::findWithAssetByIdIn).stream()
                .collect(Collectors.toMap(AssetVersion::getId, Function.identity()));
    }

    private static AssetRelease copy(AssetRelease pointer, String localeKey, long revision) {
        return new AssetRelease(
                pointer.getProjectId(),
                pointer.getAssetId(),
                localeKey,
                pointer.getReleasedVersionId(),
                pointer.getReleasedUid(),
                revision,
                pointer.getReleasedBy(),
                pointer.getReleasedAt());
    }
}
