package com.acme.staticforge.release;

import com.acme.staticforge.asset.Asset;
import com.acme.staticforge.asset.AssetRepository;
import com.acme.staticforge.asset.AssetUidHistoryRepository;
import com.acme.staticforge.asset.AssetVersion;
import com.acme.staticforge.asset.AssetVersionRepository;
import com.acme.staticforge.project.LocaleConfig;
import com.acme.staticforge.project.ProjectLocales;
import com.fasterxml.jackson.databind.JsonNode;
import java.util.Collection;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.function.Function;
import java.util.stream.Collectors;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Computes {@link ReleaseStatus} per (asset, locale) (M27.1.1, epic decision 6) from the draft — the open version
 * and the asset's uid — and the open release pointer:
 *
 * <ul>
 *   <li>no pointer: {@link ReleaseStatus#UNPUBLISHED} if the pair was ever released, else {@link ReleaseStatus#NEW};
 *       a deleted draft without a pointer has no status at all (it is gone, not pending);
 *   <li>a pointer and a deleted draft: {@link ReleaseStatus#DELETION_PENDING};
 *   <li>a pointer at the draft itself under the same uid: {@link ReleaseStatus#PUBLISHED} without projecting;
 *   <li>otherwise the {@link LocaleProjection}s decide between {@link ReleaseStatus#PUBLISHED} and
 *       {@link ReleaseStatus#CHANGED}.
 * </ul>
 *
 * <p>The bulk entry points cost a fixed number of queries whatever the asset count (pointers, release history and
 * released versions each in one chunked query) and project each (version, locale) at most once per call.
 */
@Service
public class ReleaseStatusService {

    private final AssetRepository assetRepository;
    private final AssetVersionRepository versionRepository;
    private final AssetReleaseRepository releaseRepository;
    private final ProjectLocales projectLocales;
    private final AssetUidHistoryRepository uidHistory;

    public ReleaseStatusService(
            AssetRepository assetRepository,
            AssetVersionRepository versionRepository,
            AssetReleaseRepository releaseRepository,
            ProjectLocales projectLocales,
            AssetUidHistoryRepository uidHistory) {
        this.assetRepository = assetRepository;
        this.versionRepository = versionRepository;
        this.releaseRepository = releaseRepository;
        this.projectLocales = projectLocales;
        this.uidHistory = uidHistory;
    }

    /**
     * The status of one asset per locale key, in locale order; empty when the asset is not releasable, unknown, or
     * deleted and released nowhere.
     */
    @Transactional(readOnly = true)
    public Map<String, LocaleRelease> ofAsset(long projectId, UUID assetUuid) {
        Optional<Asset> asset = assetRepository.findByProjectIdAndUuid(projectId, assetUuid);
        if (asset.isEmpty()) {
            return Map.of();
        }
        Optional<AssetVersion> open = versionRepository.findByAssetIdAndValidToRevisionIsNull(asset.get().getId());
        if (open.isEmpty()) {
            return Map.of();
        }
        return of(projectId, List.of(new Draft(asset.get(), open.get()))).getOrDefault(asset.get().getId(), Map.of());
    }

    /**
     * The status of several assets by uuid, keyed by uuid — what a list or tree endpoint adds to its rows. A fixed
     * number of queries whatever the count; assets without a release state (templates, unknown uuids, tombstones
     * released nowhere) are absent.
     */
    @Transactional(readOnly = true)
    public Map<UUID, Map<String, LocaleRelease>> ofUuids(long projectId, Collection<UUID> uuids) {
        if (uuids.isEmpty()) {
            return Map.of();
        }
        List<Asset> assets = Chunks.flatMap(Set.copyOf(uuids), chunk -> assetRepository.findByProjectIdAndUuidIn(projectId, chunk));
        Map<Long, UUID> uuidById = assets.stream().collect(Collectors.toMap(Asset::getId, Asset::getUuid));
        List<AssetVersion> open = Chunks.flatMap(uuidById.keySet(), versionRepository::findOpenWithAssetByAssetIdIn);
        Map<Long, Map<String, LocaleRelease>> byId = ofVersions(projectId, open);
        Map<UUID, Map<String, LocaleRelease>> out = new LinkedHashMap<>();
        byId.forEach((id, locales) -> out.put(uuidById.get(id), locales));
        return out;
    }

    /**
     * {@link #ofUuids} as of revision {@code revision} (time travel): the drafts valid then against the pointers valid
     * then, under the uids the assets had then. Same fixed number of queries whatever the count; assets that did not
     * exist then, were deleted then, or have no release state are absent.
     */
    @Transactional(readOnly = true)
    public Map<UUID, Map<String, LocaleRelease>> ofUuidsAt(long projectId, Collection<UUID> uuids, long revision) {
        if (uuids.isEmpty()) {
            return Map.of();
        }
        Map<Long, Asset> assets = Chunks.flatMap(Set.copyOf(uuids), chunk -> assetRepository.findByProjectIdAndUuidIn(projectId, chunk))
                .stream()
                .collect(Collectors.toMap(Asset::getId, Function.identity()));
        Map<Long, String> uids = uidHistory.uidsAt(projectId, revision);
        List<Draft> drafts = Chunks.flatMap(assets.keySet(), ids -> versionRepository.findValidAtRevisionByAssetIdIn(ids, revision))
                .stream()
                .map(v -> {
                    Asset asset = assets.get(v.getAssetId());
                    return new Draft(asset, v, uids.getOrDefault(asset.getId(), asset.getUid()));
                })
                .toList();
        Map<UUID, Map<String, LocaleRelease>> out = new LinkedHashMap<>();
        of(projectId, drafts, revision).forEach((id, locales) -> out.put(assets.get(id).getUuid(), locales));
        return out;
    }

    /**
     * The status of every releasable asset of a project, keyed by asset id, each with its locale keys in order.
     * Tombstones released nowhere are left out.
     */
    @Transactional(readOnly = true)
    public Map<Long, Map<String, LocaleRelease>> ofProject(long projectId) {
        List<AssetVersion> open =
                versionRepository.findOpenWithAssetByProjectAndTypeIn(projectId, ReleasableTypes.candidateTypes());
        return of(projectId, open.stream().map(v -> new Draft(v.getAsset(), v)).toList());
    }

    /**
     * The status of the given open versions, whose {@link AssetVersion#getAsset() asset} must be loaded (or loadable)
     * — what a list or tree endpoint that already holds the versions calls, so it adds no per-row query.
     */
    @Transactional(readOnly = true)
    public Map<Long, Map<String, LocaleRelease>> ofVersions(long projectId, Collection<AssetVersion> openVersions) {
        return of(projectId, openVersions.stream().map(v -> new Draft(v.getAsset(), v)).toList());
    }

    /** The status of drafts given as (asset, open version) pairs. */
    @Transactional(readOnly = true)
    public Map<Long, Map<String, LocaleRelease>> of(long projectId, Collection<Draft> drafts) {
        return of(projectId, drafts, null);
    }

    /** {@link #of(long, Collection)} against the pointers valid at {@code revision}; the current ones when {@code null}. */
    private Map<Long, Map<String, LocaleRelease>> of(long projectId, Collection<Draft> drafts, Long revision) {
        LocaleConfig config = projectLocales.forProject(projectId);
        List<Draft> releasable = drafts.stream()
                .filter(d -> ReleasableTypes.isReleasable(d.asset().getAssetType(), d.version().getPayload(), d.uid()))
                .toList();
        if (releasable.isEmpty()) {
            return Map.of();
        }
        Set<Long> assetIds = releasable.stream().map(d -> d.asset().getId()).collect(Collectors.toSet());

        Map<ReleasedKey, AssetRelease> open = new HashMap<>();
        List<AssetRelease> pointers = revision == null
                ? Chunks.flatMap(assetIds, releaseRepository::findByAssetIdInAndValidToRevisionIsNull)
                : Chunks.flatMap(assetIds, ids -> releaseRepository.findValidAtByAssetIdIn(ids, revision));
        for (AssetRelease pointer : pointers) {
            open.put(new ReleasedKey(pointer.getAssetId(), pointer.getLocaleKey()), pointer);
        }
        Set<ReleasedKey> everReleased = new HashSet<>(revision == null
                ? Chunks.flatMap(assetIds, releaseRepository::findEverReleasedKeys)
                : Chunks.flatMap(assetIds, ids -> releaseRepository.findEverReleasedKeysUpTo(ids, revision)));

        Set<Long> draftIds = releasable.stream().map(d -> d.version().getId()).collect(Collectors.toSet());
        Set<Long> releasedIds = open.values().stream()
                .map(AssetRelease::getReleasedVersionId)
                .filter(id -> !draftIds.contains(id))
                .collect(Collectors.toSet());
        Map<Long, AssetVersion> releasedVersions = releasedIds.isEmpty()
                ? Map.of()
                : Chunks.flatMap(releasedIds, versionRepository::findAllById).stream()
                        .collect(Collectors.toMap(AssetVersion::getId, Function.identity()));

        Projections projections = new Projections(config);
        Map<Long, Map<String, LocaleRelease>> out = new LinkedHashMap<>();
        for (Draft draft : releasable) {
            Map<String, LocaleRelease> locales = new LinkedHashMap<>();
            for (String key : ReleaseLocales.keysFor(config, draft.asset().getAssetType(), draft.version().getPayload())) {
                ReleasedKey id = new ReleasedKey(draft.asset().getId(), key);
                LocaleRelease status = status(draft, key, open.get(id), everReleased.contains(id), releasedVersions, projections);
                if (status != null) {
                    locales.put(key, status);
                }
            }
            if (!locales.isEmpty()) {
                out.put(draft.asset().getId(), locales);
            }
        }
        return out;
    }

    private static LocaleRelease status(
            Draft draft,
            String key,
            AssetRelease pointer,
            boolean everReleased,
            Map<Long, AssetVersion> releasedVersions,
            Projections projections) {
        AssetVersion version = draft.version();
        if (pointer == null) {
            if (version.isDeleted()) {
                return null;
            }
            return LocaleRelease.unreleased(key, everReleased ? ReleaseStatus.UNPUBLISHED : ReleaseStatus.NEW);
        }
        if (version.isDeleted()) {
            return LocaleRelease.of(key, ReleaseStatus.DELETION_PENDING, pointer);
        }
        String uid = draft.uid();
        if (pointer.getReleasedVersionId().equals(version.getId()) && Objects.equals(pointer.getReleasedUid(), uid)) {
            return LocaleRelease.of(key, ReleaseStatus.PUBLISHED, pointer);
        }
        AssetVersion released = pointer.getReleasedVersionId().equals(version.getId())
                ? version
                : releasedVersions.get(pointer.getReleasedVersionId());
        if (released == null) {
            // A pointer at a version that no longer exists can only come from a broken import or manual SQL:
            // report it as changed so a release repairs it, rather than hiding the asset.
            return LocaleRelease.of(key, ReleaseStatus.CHANGED, pointer);
        }
        boolean same = projections.of(version, uid, key).equals(projections.of(released, pointer.getReleasedUid(), key));
        return LocaleRelease.of(key, same ? ReleaseStatus.PUBLISHED : ReleaseStatus.CHANGED, pointer);
    }

    /**
     * An asset and its open version (the draft), possibly a tombstone; {@code uid} is the uid the draft is rendered
     * under (the asset's current one, unless a time-travel read asks for the uid it had then).
     */
    public record Draft(Asset asset, AssetVersion version, String uid) {

        public Draft(Asset asset, AssetVersion version) {
            this(asset, version, asset.getUid());
        }
    }

    /** Per-call memo: every (version, uid, locale) is projected once. */
    private static final class Projections {

        private final LocaleConfig config;
        private final Map<ProjectionKey, JsonNode> cache = new HashMap<>();

        Projections(LocaleConfig config) {
            this.config = config;
        }

        JsonNode of(AssetVersion version, String uid, String localeKey) {
            return cache.computeIfAbsent(
                    new ProjectionKey(version.getId(), uid, localeKey),
                    k -> LocaleProjection.project(version, uid, localeKey, config));
        }
    }

    private record ProjectionKey(Long versionId, String uid, String localeKey) {}
}
