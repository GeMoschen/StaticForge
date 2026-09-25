package com.acme.staticforge.release;

import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * The release state of a project at one revision (M27.1.1): for each (asset, locale key) the pointer valid at that
 * revision. Immutable; built by {@link ReleaseStates#at}. A build at revision R reads this and nothing else to decide
 * what is released (M27.2.1).
 */
public final class ReleaseState {

    private final long projectId;
    private final long revision;
    private final Map<Long, Map<String, AssetRelease>> byAsset;

    ReleaseState(long projectId, long revision, List<AssetRelease> pointers) {
        this.projectId = projectId;
        this.revision = revision;
        Map<Long, Map<String, AssetRelease>> index = new HashMap<>();
        for (AssetRelease pointer : pointers) {
            index.computeIfAbsent(pointer.getAssetId(), id -> new HashMap<>()).put(pointer.getLocaleKey(), pointer);
        }
        index.replaceAll((id, locales) -> Map.copyOf(locales));
        this.byAsset = Map.copyOf(index);
    }

    public long projectId() {
        return projectId;
    }

    public long revision() {
        return revision;
    }

    /** The pointer of (asset, locale key) valid at {@link #revision()}, or {@code null} when not released there. */
    public AssetRelease pointer(long assetId, String localeKey) {
        Map<String, AssetRelease> locales = byAsset.get(assetId);
        return locales == null ? null : locales.get(localeKey);
    }

    /** The released version id of (asset, locale key), or {@code null} when not released there. */
    public Long releasedVersionId(long assetId, String localeKey) {
        AssetRelease pointer = pointer(assetId, localeKey);
        return pointer == null ? null : pointer.getReleasedVersionId();
    }

    /** Every locale key under which the asset is released, with its pointer; empty when it isn't released at all. */
    public Map<String, AssetRelease> pointers(long assetId) {
        return byAsset.getOrDefault(assetId, Map.of());
    }

    /** The ids of every asset released in at least one locale. */
    public Set<Long> releasedAssetIds() {
        return Collections.unmodifiableSet(byAsset.keySet());
    }

    /** The number of pointers (asset × locale pairs) in this state. */
    public int size() {
        return byAsset.values().stream().mapToInt(Map::size).sum();
    }
}
