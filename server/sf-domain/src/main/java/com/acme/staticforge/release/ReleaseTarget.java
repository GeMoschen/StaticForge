package com.acme.staticforge.release;

import com.acme.staticforge.asset.AssetType;
import java.util.UUID;

/**
 * A resolved (asset, locale key) of a release request, with its status before the request (M27.1.2).
 *
 * @param versionId the version a release would point at (the pinned one, else the draft); {@code null} for a
 *     deleted draft
 * @param status {@code null} for a deleted asset that is released nowhere (nothing to do)
 */
public record ReleaseTarget(
        UUID assetUuid,
        AssetType type,
        String uid,
        String displayName,
        String locale,
        ReleaseStatus status,
        Long versionId) {}
