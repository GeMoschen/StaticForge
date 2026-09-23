package com.acme.staticforge.asset;

import com.acme.staticforge.asset.folder.FolderScope;
import com.acme.staticforge.common.Slugifier;
import java.util.Locale;
import java.util.Set;
import java.util.concurrent.ThreadLocalRandom;
import org.springframework.stereotype.Component;

/**
 * Derives human-readable UIDs from display names (spec §6.3). Uniqueness is probed
 * against the repository within {@code (projectId, assetType)}; reserved words get a
 * {@code _1} suffix.
 */
@Component
public class UidGenerator {

    private static final Set<String> RESERVED = Set.of(
            "new", "edit", "index", "api", "preview", "_generated",
            // M13.1.2: the two fixed, auto-provisioned TEMPLATES-scope root folders — no
            // user-derived uid may ever collide with them.
            FolderScope.PAGE_TEMPLATES_UID, FolderScope.SECTION_TEMPLATES_UID,
            // The fixed, auto-provisioned NAVIGATION-scope root and the fixed, auto-provisioned
            // wrapper root of the TEMPLATES-scope tree — same reservation rationale.
            FolderScope.NAVIGATION_ROOT_UID, FolderScope.TEMPLATES_ROOT_UID,
            // The fixed, auto-provisioned PAGES/MEDIA-scope roots — same reservation rationale.
            FolderScope.PAGES_ROOT_UID, FolderScope.MEDIA_ROOT_UID,
            // M17.1.1: the fixed, auto-provisioned GLOBALS-scope root — same reservation rationale.
            FolderScope.GLOBALS_ROOT_UID,
            // M19.1.1: the fixed Content-store root and the fixed dataset-schema folder.
            FolderScope.CONTENT_ROOT_UID, FolderScope.DATASETS_UID);
    private static final int PROBE_LIMIT = 10_000;

    private final Slugifier slugifier = new Slugifier();
    private final AssetRepository assetRepository;

    public UidGenerator(AssetRepository assetRepository) {
        this.assetRepository = assetRepository;
    }

    /**
     * Variant used on import (feature cross-project-import-identity, M9.3.1): prefers the
     * archive's own {@code preferredUid} — carrying the asset's human-readable identity across
     * the export/import round-trip, same as its UUID — and falls back to deriving fresh from
     * {@code displayName} only when that preferred uid is blank, reserved, or already taken in
     * the target project (a same-type collision the caller resolves by minting a fresh uuid
     * anyway, so a fresh uid follows the same fallback here).
     */
    public String deriveUid(String preferredUid, String displayName, long projectId, AssetType assetType) {
        if (preferredUid != null && !preferredUid.isBlank() && !isReserved(preferredUid)
                && !taken(preferredUid, projectId, assetType)) {
            return preferredUid;
        }
        return deriveUid(displayName, projectId, assetType);
    }

    public String deriveUid(String displayName, long projectId, AssetType assetType) {
        String base = slugifier.slug(displayName);
        if (base.isEmpty()) {
            base = assetType.name().toLowerCase(Locale.ROOT);
        }
        if (RESERVED.contains(base)) {
            base = base + "_1";
        }
        return resolveUnique(base, projectId, assetType);
    }

    /** True when {@code uid} is one of the reserved words (§6.3 step 7). */
    public boolean isReserved(String uid) {
        return uid != null && RESERVED.contains(uid);
    }

    private String resolveUnique(String base, long projectId, AssetType assetType) {
        if (!taken(base, projectId, assetType)) {
            return base;
        }
        for (int i = 1; i <= PROBE_LIMIT; i++) {
            String candidate = base + "_" + i;
            if (!taken(candidate, projectId, assetType)) {
                return candidate;
            }
        }
        return base + "_" + randomSuffix();
    }

    private boolean taken(String uid, long projectId, AssetType assetType) {
        return assetRepository.findByProjectIdAndAssetTypeAndUid(projectId, assetType, uid).isPresent();
    }

    private String randomSuffix() {
        StringBuilder sb = new StringBuilder(6);
        for (int i = 0; i < 6; i++) {
            sb.append((char) ('a' + ThreadLocalRandom.current().nextInt(26)));
        }
        return sb.toString();
    }
}
