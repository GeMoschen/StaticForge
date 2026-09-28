package com.acme.staticforge.urlregistry;

import com.acme.staticforge.asset.Asset;
import com.acme.staticforge.asset.AssetReference;
import com.acme.staticforge.asset.AssetReferenceRepository;
import com.acme.staticforge.asset.AssetRepository;
import com.acme.staticforge.asset.AssetType;
import com.acme.staticforge.asset.AssetVersion;
import com.acme.staticforge.asset.AssetVersionRepository;
import com.acme.staticforge.asset.ReferenceKind;
import com.acme.staticforge.asset.folder.PathService;
import com.acme.staticforge.asset.folder.StartPage;
import com.acme.staticforge.asset.navigation.LiveNavigationLookup;
import com.acme.staticforge.asset.navigation.NavigationService;
import com.fasterxml.jackson.databind.JsonNode;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Objects;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import org.springframework.stereotype.Component;

/**
 * Drops the URL-registry rows a folder's start-page change makes stale (M31, spec §17). Registry rows are assign-once,
 * so a navigation href computed before the change would keep opening the old page: the old start page leaves the
 * folder's index path, the new one takes it, and folder references now resolve to the new start page.
 *
 * <p>Deleted are the <em>computed</em> ({@code overridden = false}) rows, in both areas, every channel and language, of
 * the page references
 * <ul>
 *   <li>targeting the old or the new start page (their output paths move),</li>
 *   <li>targeting the folder (they resolve to its index page), and</li>
 *   <li>targeting an ancestor folder whose resolution walks down into this folder — it currently resolves to one of
 *       the folder's pages — since the walk prefers each folder's index page.</li>
 * </ul>
 * They are recomputed on their next access. A manual override is never touched. The references are found through the
 * materialized {@code NAV} edges; the ancestor walk reads the drafts, like every computed {@code PREVIEW} row.
 *
 * <p>Runs inside the caller's transaction, after the folder's new version is written: every draft write of a folder
 * payload ({@code AssetServiceImpl.update}/{@code restore}, which the start-page endpoint, discard and restore use) and
 * a release that changes the folder's released start page.
 */
@Component
public class StartPageUrlInvalidation {

    private final UrlRegistryRepository registry;
    private final AssetRepository assets;
    private final AssetVersionRepository versions;
    private final AssetReferenceRepository references;
    private final NavigationService navigation;
    private final LiveNavigationLookup lookup;

    public StartPageUrlInvalidation(
            UrlRegistryRepository registry,
            AssetRepository assets,
            AssetVersionRepository versions,
            AssetReferenceRepository references,
            NavigationService navigation,
            LiveNavigationLookup lookup) {
        this.registry = registry;
        this.assets = assets;
        this.versions = versions;
        this.references = references;
        this.navigation = navigation;
        this.lookup = lookup;
    }

    /**
     * Invalidates for a folder version written with {@code after} as its payload where {@code before} was: a no-op
     * unless the asset is a folder whose {@code startPage} differs between the two.
     */
    public void payloadChanged(Asset folder, JsonNode before, JsonNode after) {
        if (folder.getAssetType() != AssetType.FOLDER) {
            return;
        }
        startPageChanged(folder, StartPage.fromPayload(before), StartPage.fromPayload(after));
    }

    /** Invalidates for {@code folder}'s start page changing from {@code before} to {@code after} (either may be null). */
    public void startPageChanged(Asset folder, UUID before, UUID after) {
        if (Objects.equals(before, after)) {
            return;
        }
        long projectId = folder.getProjectId();
        Set<UUID> startPages = new HashSet<>();
        Set<Long> direct = new LinkedHashSet<>();
        direct.add(folder.getId());
        for (UUID page : new UUID[] {before, after}) {
            if (page != null) {
                startPages.add(page);
                assets.findByProjectIdAndUuid(projectId, page).ifPresent(asset -> direct.add(asset.getId()));
            }
        }

        Set<UUID> stale = new LinkedHashSet<>(pageReferences(direct));
        for (UUID reference : pageReferences(ancestors(folder))) {
            if (!stale.contains(reference) && walksInto(projectId, reference, folder, startPages)) {
                stale.add(reference);
            }
        }
        if (!stale.isEmpty()) {
            registry.deleteByProjectIdAndPageReferenceUuidInAndOverriddenFalse(projectId, stale);
        }
    }

    /** The live page references with an open {@code NAV} edge to one of {@code targets}. */
    private List<UUID> pageReferences(Set<Long> targets) {
        Set<Long> from = new LinkedHashSet<>();
        for (Long target : targets) {
            for (AssetReference edge : references.findIncomingOpen(target)) {
                if (edge.getKind() == ReferenceKind.NAV) {
                    from.add(edge.getFromAssetId());
                }
            }
        }
        List<UUID> found = new ArrayList<>();
        for (Asset asset : assets.findAllById(from)) {
            if (asset.getAssetType() == AssetType.PAGE_REFERENCE) {
                found.add(asset.getUuid());
            }
        }
        return found;
    }

    /** The folder's ancestors in the drafts, nearest first, up to (and including) the store root. */
    private Set<Long> ancestors(Asset folder) {
        Set<Long> found = new LinkedHashSet<>();
        Long parent = current(folder.getId()).map(AssetVersion::getFolderId).orElse(null);
        while (parent != null && found.size() <= PathService.MAX_DEPTH && found.add(parent)) {
            parent = current(parent).map(AssetVersion::getFolderId).orElse(null);
        }
        return found;
    }

    /** Whether a reference to an ancestor now resolves into {@code folder}: to one of its pages or a start page. */
    private boolean walksInto(long projectId, UUID reference, Asset folder, Set<UUID> startPages) {
        UUID page = navigation.resolve(projectId, reference, lookup);
        if (page == null) {
            return false;
        }
        if (startPages.contains(page)) {
            return true;
        }
        return assets.findByProjectIdAndUuid(projectId, page)
                .flatMap(asset -> current(asset.getId()))
                .map(version -> folder.getId().equals(version.getFolderId()))
                .orElse(false);
    }

    private Optional<AssetVersion> current(Long assetId) {
        return versions.findByAssetIdAndValidToRevisionIsNull(assetId).filter(version -> !version.isDeleted());
    }
}
