package com.acme.staticforge.release;

import com.acme.staticforge.asset.Asset;
import com.acme.staticforge.asset.AssetRepository;
import com.acme.staticforge.asset.AssetVersion;
import com.acme.staticforge.asset.AssetVersionRepository;
import com.acme.staticforge.asset.AssetVersionView;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

/**
 * What a reader renders of a project's content at one revision in one language (M27.2.3, epic decision 16): the
 * drafts, or the release state. The live-state counterpart of generation's {@code Snapshot} view: preview resolves
 * pages, navigation and cross-asset values through one of these instead of reading versions directly, so the page,
 * its navigation and its values always come from the same state.
 *
 * <ul>
 *   <li>{@link Kind#DRAFT}: every asset at its version valid at the revision (the current one without a revision);
 *   <li>{@link Kind#PUBLISHED}: a releasable asset at the version its pointer valid at the revision names for the
 *       language (or the shared {@code ""} pointer), under the uid it was released with, and absent without one; live
 *       types (templates, datasets) as in the draft view.
 * </ul>
 *
 * <p>Not thread-safe; one per render. Reads are memoized per asset.
 */
public final class ContentView {

    /** Which state a view renders. */
    public enum Kind {
        DRAFT,
        PUBLISHED;

        /** {@code draft} / {@code published}, ignoring case; {@code null} or blank is the draft. */
        public static Kind parse(String value) {
            if (value == null || value.isBlank()) {
                return DRAFT;
            }
            return valueOf(value.trim().toUpperCase(Locale.ROOT));
        }

        /** The lower-case name the API and share tokens use. */
        public String wireName() {
            return name().toLowerCase(Locale.ROOT);
        }
    }

    /** An asset as this view renders it. */
    public record Resolved(Asset asset, AssetVersion version, String uid) {

        public AssetVersionView view() {
            return new AssetVersionView(
                    asset.getUuid(),
                    uid,
                    asset.getAssetType(),
                    version.getDisplayName(),
                    version.getPayload(),
                    version.getValidFromRevision(),
                    version.isDeleted(),
                    version.getFolderId(),
                    version.getFolderPath(),
                    version.getTemplateAssetId(),
                    version.getChangedBy(),
                    version.getChangedAt());
        }
    }

    private final long projectId;
    private final long revision;
    private final boolean current;
    private final Kind kind;
    private final String localeKey;
    private final AssetRepository assets;
    private final AssetVersionRepository versions;
    private final AssetReleaseRepository releases;
    private final Map<Long, Optional<Resolved>> resolved = new HashMap<>();

    ContentView(
            long projectId,
            long revision,
            boolean current,
            Kind kind,
            String localeKey,
            AssetRepository assets,
            AssetVersionRepository versions,
            AssetReleaseRepository releases) {
        this.projectId = projectId;
        this.revision = revision;
        this.current = current;
        this.kind = kind;
        this.localeKey = localeKey;
        this.assets = assets;
        this.versions = versions;
        this.releases = releases;
    }

    public long projectId() {
        return projectId;
    }

    /** The revision the view reads at; the head revision for a view of the current state. */
    public long revision() {
        return revision;
    }

    public Kind kind() {
        return kind;
    }

    /** The time-travel revision, or {@code null} for a view of the current state. */
    public Long pinnedRevision() {
        return current ? null : revision;
    }

    /** The draft view of the same project, revision and language — what this view shows when nothing is unreleased. */
    public ContentView asDraft() {
        return kind == Kind.DRAFT
                ? this
                : new ContentView(projectId, revision, current, Kind.DRAFT, localeKey, assets, versions, releases);
    }

    /** The release key this view resolves pointers under: a declared locale, or {@code ""}. */
    public String localeKey() {
        return localeKey;
    }

    /** The asset {@code uuid} of this project as the view renders it; empty when absent (unknown, deleted, unreleased). */
    public Optional<Resolved> resolve(UUID uuid) {
        if (uuid == null) {
            return Optional.empty();
        }
        return assets.findByProjectIdAndUuid(projectId, uuid).flatMap(this::resolve);
    }

    /** {@code asset} as the view renders it; empty when absent. Tombstones are absent in both views. */
    public Optional<Resolved> resolve(Asset asset) {
        return resolved.computeIfAbsent(asset.getId(), id -> load(asset));
    }

    private Optional<Resolved> load(Asset asset) {
        Optional<AssetVersion> draft = current
                ? versions.findByAssetIdAndValidToRevisionIsNull(asset.getId())
                : versions.findValidAtRevision(asset.getId(), revision);
        if (draft.isEmpty()) {
            return Optional.empty();
        }
        if (kind == Kind.DRAFT || !ReleasableTypes.isReleasable(asset.getAssetType(), draft.get().getPayload(), asset.getUid())) {
            return draft.filter(v -> !v.isDeleted()).map(v -> new Resolved(asset, v, asset.getUid()));
        }
        AssetRelease pointer = pointer(releases.findValidAtByAssetIdIn(List.of(asset.getId()), revision));
        if (pointer == null) {
            return Optional.empty();
        }
        return versions.findById(pointer.getReleasedVersionId())
                .filter(v -> !v.isDeleted())
                .map(v -> new Resolved(asset, v, pointer.getReleasedUid()));
    }

    /** Whether {@code asset} exists in the view's draft state but not in its published state — "not published here". */
    public boolean isUnreleased(Asset asset) {
        if (kind != Kind.PUBLISHED || resolve(asset).isPresent()) {
            return false;
        }
        Optional<AssetVersion> draft = current
                ? versions.findByAssetIdAndValidToRevisionIsNull(asset.getId())
                : versions.findValidAtRevision(asset.getId(), revision);
        return draft.isPresent() && !draft.get().isDeleted();
    }

    /** The direct children of {@code folder} present in the view (a child's parent is its version's {@code folderId}). */
    public List<Resolved> children(Asset folder) {
        List<Resolved> out = new ArrayList<>();
        List<AssetVersion> drafts = current
                ? versions.findByFolderIdAndValidToRevisionIsNullAndDeletedFalse(folder.getId())
                : versions.findChildrenValidAt(folder.getId(), revision);
        for (AssetVersion version : drafts) {
            Asset child = assets.findById(version.getAssetId()).orElse(null);
            if (child == null) {
                continue;
            }
            if (kind == Kind.DRAFT || !ReleasableTypes.isReleasable(child.getAssetType(), version.getPayload(), child.getUid())) {
                out.add(remember(new Resolved(child, version, child.getUid())));
            }
        }
        if (kind == Kind.PUBLISHED) {
            for (Object[] row : releases.findReleasedChildrenAt(projectId, folder.getId(), revision, localeKey)) {
                out.add(remember(new Resolved((Asset) row[2], (AssetVersion) row[1], ((AssetRelease) row[0]).getReleasedUid())));
            }
        }
        return out;
    }

    /** The records of dataset {@code datasetAssetId} present in the view, assets loaded. */
    public List<Resolved> recordsOfDataset(long datasetAssetId) {
        List<Resolved> out = new ArrayList<>();
        if (kind == Kind.DRAFT) {
            List<AssetVersion> found = current
                    ? versions.findCurrentRecordsOfDataset(projectId, datasetAssetId)
                    : versions.findRecordsOfDatasetAt(projectId, datasetAssetId, revision);
            found.forEach(v -> out.add(remember(new Resolved(v.getAsset(), v, v.getAsset().getUid()))));
            return out;
        }
        for (Object[] row : releases.findReleasedRecordsOfDatasetAt(projectId, datasetAssetId, revision, localeKey)) {
            out.add(remember(new Resolved((Asset) row[2], (AssetVersion) row[1], ((AssetRelease) row[0]).getReleasedUid())));
        }
        return out;
    }

    private Resolved remember(Resolved found) {
        resolved.putIfAbsent(found.asset().getId(), Optional.of(found));
        return found;
    }

    /** The pointer this view's key renders among an asset's pointers: its own key, else the shared {@code ""} one. */
    private AssetRelease pointer(List<AssetRelease> pointers) {
        AssetRelease shared = null;
        for (AssetRelease pointer : pointers) {
            if (pointer.getLocaleKey().equals(localeKey)) {
                return pointer;
            }
            if (ReleaseLocales.ALL.equals(pointer.getLocaleKey())) {
                shared = pointer;
            }
        }
        return shared;
    }
}
