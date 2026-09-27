package com.acme.staticforge.generate.snapshot;

import com.acme.staticforge.asset.Asset;
import com.acme.staticforge.asset.AssetVersion;
import com.acme.staticforge.asset.AssetType;
import com.acme.staticforge.asset.AssetVersionRepository;
import com.acme.staticforge.asset.media.MediaVariantRepository;
import com.acme.staticforge.asset.media.MediaVariantResolver;
import com.acme.staticforge.project.LocaleConfig;
import com.acme.staticforge.project.ProjectLocales;
import com.acme.staticforge.release.AssetRelease;
import com.acme.staticforge.release.ReleasableTypes;
import com.acme.staticforge.release.ReleaseLocales;
import com.acme.staticforge.release.ReleaseState;
import com.acme.staticforge.release.ReleaseStates;
import com.acme.staticforge.revision.RevisionRepository;
import com.fasterxml.jackson.databind.JsonNode;
import java.util.ArrayList;
import java.util.Collection;
import java.util.Collections;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;
import org.springframework.stereotype.Service;

/**
 * Materializes a revision-pinned {@link Snapshot} of a project's assets for generation (spec §18.2). The asset rows
 * are JOIN-fetched by the repository queries, so no lazy access occurs during mapping.
 *
 * <p>A run without a revision is pinned to the project's head revision and loads exactly what a run pinned to that
 * revision loads: every version valid there, <em>soft-deleted versions included</em>. Consumers skip deleted assets
 * where they publish ({@link Snapshot#pages()}, the planner, asset copy, navigation), while references to a deleted
 * target still resolve and degrade to an empty render with a warning (spec §16.4) instead of failing VALIDATE as an
 * unknown UID.
 *
 * <p><b>Released view (M27.2.1).</b> Releasable assets resolve, per locale, to the version their release pointer
 * valid at the revision names — with the uid it was released under — and to an absent marker where no pointer is
 * open ({@link SnapshotAsset#unreleased()}). Live types keep their version at the revision. The cost is two queries
 * on top of the draft load: the pointers valid at the revision, and the released versions that aren't the ones
 * already loaded (usually few: a pointer at an unchanged asset names its version valid at the revision). A version
 * shared by several locales becomes one {@link SnapshotAsset}.
 *
 * <p><b>Media variants (M29.3.2).</b> A media asset's payload carries its merged variants
 * ({@link MediaVariantResolver#withVariants}): the payload's own and the derived ones of {@code media_variant} for the
 * current policy, read with one query per snapshot. So the renderer's {@code $CMS_REF(media:…, variant=…)}, the ASSETS
 * stage and everything else that reads a snapshot's media see backfilled variants. The payload is a copy; the stored
 * version is never changed.
 */
@Service
public class SnapshotService {

    private final AssetVersionRepository versions;
    private final RevisionRepository revisions;
    private final ReleaseStates releaseStates;
    private final ProjectLocales projectLocales;
    private final MediaVariantResolver variantResolver;

    public SnapshotService(
            AssetVersionRepository versions,
            RevisionRepository revisions,
            ReleaseStates releaseStates,
            ProjectLocales projectLocales,
            MediaVariantResolver variantResolver) {
        this.versions = versions;
        this.revisions = revisions;
        this.releaseStates = releaseStates;
        this.projectLocales = projectLocales;
        this.variantResolver = variantResolver;
    }

    /**
     * The project's snapshot at {@code revision} (the head revision when {@code null}) in {@code view}: generation
     * renders {@link SnapshotView#RELEASED}.
     */
    public Snapshot snapshot(long projectId, Long revision, SnapshotView view) {
        return snapshot(projectId, revision, view, Set.of());
    }

    /**
     * As {@link #snapshot(long, Long, SnapshotView)}, with {@code asDrafts} at their draft in every locale of the
     * released view — the site as it would be if those drafts were released (the impact of a draft, M27.2.2).
     */
    public Snapshot snapshot(long projectId, Long revision, SnapshotView view, Set<UUID> asDrafts) {
        long pinnedRevision = revision != null ? revision : revisions.findHeadRevisionId(projectId).orElse(0L);
        List<AssetVersion> loaded = versions.findSnapshot(projectId, pinnedRevision);
        Set<Long> mediaAssetIds = loaded.stream()
                .filter(v -> v.getAsset().getAssetType() == AssetType.MEDIA)
                .map(AssetVersion::getAssetId)
                .collect(Collectors.toSet());
        Map<String, List<MediaVariantRepository.Row>> variants = new HashMap<>(variantRows(loaded, mediaAssetIds));
        Map<AssetVersion, SnapshotAsset> drafts = new LinkedHashMap<>();
        loaded.forEach(v -> drafts.put(v, toAsset(v, v.getAsset(), v.getAsset().getUid(), variants)));

        Map<String, Snapshot.Layer> layers = new LinkedHashMap<>();
        if (view == SnapshotView.DRAFT) {
            layers.put(null, layer(drafts.values()));
            return Snapshot.of(projectId, pinnedRevision, view, null, layers);
        }

        LocaleConfig config = LocaleConfig.orEmpty(projectLocales.forProject(projectId));
        ReleaseState state = releaseStates.at(projectId, pinnedRevision);
        Map<Long, AssetVersion> byId = new HashMap<>(releaseStates.releasedVersions(state, ids(loaded)));
        variants.putAll(variantRows(byId.values(), mediaAssetIds));
        loaded.forEach(v -> byId.put(v.getId(), v));

        Map<ReleasedAsset, SnapshotAsset> released = new HashMap<>();
        Map<Long, SnapshotAsset> unreleased = new HashMap<>();
        List<String> locales = config.isLocalized() ? config.codes() : Collections.singletonList(null);
        for (String locale : locales) {
            String key = locale == null ? ReleaseLocales.ALL : locale;
            List<SnapshotAsset> assets = new ArrayList<>(drafts.size());
            drafts.forEach((draftVersion, draft) -> {
                Asset asset = draftVersion.getAsset();
                if (asDrafts.contains(asset.getUuid())
                        || !ReleasableTypes.isReleasable(asset.getAssetType(), draftVersion.getPayload(), asset.getUid())) {
                    assets.add(draft);
                    return;
                }
                AssetRelease pointer = pointer(state, asset.getId(), key);
                AssetVersion version = pointer == null ? null : byId.get(pointer.getReleasedVersionId());
                if (version != null) {
                    assets.add(released.computeIfAbsent(
                            new ReleasedAsset(version.getId(), pointer.getReleasedUid()),
                            k -> k.versionId() == draftVersion.getId() && k.uid().equals(draft.uid())
                                    ? draft
                                    : toAsset(version, asset, k.uid(), variants)));
                } else if (draftVersion.isDeleted()) {
                    assets.add(draft); // a tombstone released nowhere is simply gone
                } else {
                    assets.add(unreleased.computeIfAbsent(asset.getId(), id -> draft.asUnreleased()));
                }
            });
            layers.put(locale, layer(assets));
        }
        return Snapshot.of(projectId, pinnedRevision, view, config.isLocalized() ? config.defaultLocale() : null, layers);
    }

    /** The pointer {@code key} renders: its own, or the shared {@code ""} pointer (non-localized media). */
    private static AssetRelease pointer(ReleaseState state, long assetId, String key) {
        AssetRelease own = state.pointer(assetId, key);
        return own != null || ReleaseLocales.ALL.equals(key) ? own : state.pointer(assetId, ReleaseLocales.ALL);
    }

    /** One released (version, uid) pair — what several locales can share. */
    private record ReleasedAsset(long versionId, String uid) {}

    /** The {@code media_variant} rows of the source blobs of every media version in {@code loaded} (one query). */
    private Map<String, List<MediaVariantRepository.Row>> variantRows(
            Collection<AssetVersion> loaded, Set<Long> mediaAssetIds) {
        Set<String> shas = new HashSet<>();
        for (AssetVersion v : loaded) {
            if (mediaAssetIds.contains(v.getAssetId())) {
                shas.addAll(MediaVariantResolver.sourceShas(v.getPayload()));
            }
        }
        return shas.isEmpty() ? Map.of() : variantResolver.rowsFor(shas);
    }

    private SnapshotAsset toAsset(
            AssetVersion v, Asset asset, String uid, Map<String, List<MediaVariantRepository.Row>> variants) {
        JsonNode payload = asset.getAssetType() == AssetType.MEDIA
                ? variantResolver.withVariants(v.getPayload(), variants)
                : v.getPayload();
        return new SnapshotAsset(
                asset.getUuid(),
                v.getAssetId(),
                asset.getAssetType(),
                uid,
                v.getDisplayName(),
                v.getFolderPath(),
                payload,
                v.isDeleted(),
                v.getChangedAt(),
                v.getFolderId());
    }

    private static Snapshot.Layer layer(Iterable<SnapshotAsset> assets) {
        Map<UUID, SnapshotAsset> byUuid = new HashMap<>();
        Map<Long, SnapshotAsset> byAssetId = new HashMap<>();
        for (SnapshotAsset sa : assets) {
            byAssetId.put(sa.assetId(), sa);
            if (sa.uuid() != null) {
                byUuid.put(sa.uuid(), sa);
            }
        }
        return new Snapshot.Layer(byUuid, byAssetId);
    }

    private static Set<Long> ids(List<AssetVersion> loaded) {
        return loaded.stream().map(AssetVersion::getId).collect(Collectors.toSet());
    }
}
