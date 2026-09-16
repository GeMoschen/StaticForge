package com.acme.staticforge.asset.reference;

import com.acme.staticforge.asset.Asset;
import com.acme.staticforge.asset.AssetReferenceRepository;
import com.acme.staticforge.asset.AssetRepository;
import com.acme.staticforge.asset.AssetVersion;
import com.acme.staticforge.asset.AssetVersionRepository;
import com.acme.staticforge.revision.RevisionAware;
import java.util.List;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Rebuilds {@code asset_reference} from {@code asset_version} (M16.3.3): for every asset, its rows
 * are dropped and {@link ReferenceMaterializer} is replayed over the asset's versions in revision
 * order, so the rebuilt intervals are exactly what the write path would have produced. The result
 * is deterministic, so running it again is harmless.
 *
 * <p>One approximation: template OCTL references resolve {@code assetType:uid} against the
 * <em>current</em> UIDs, so a historical template version referencing a since-renamed UID gets the
 * edge its source resolves to today.
 */
@Service
@RevisionAware
public class ReferenceBackfill {

    private final AssetRepository assets;
    private final AssetVersionRepository versions;
    private final AssetReferenceRepository references;
    private final ReferenceMaterializer materializer;

    public ReferenceBackfill(
            AssetRepository assets,
            AssetVersionRepository versions,
            AssetReferenceRepository references,
            ReferenceMaterializer materializer) {
        this.assets = assets;
        this.versions = versions;
        this.references = references;
        this.materializer = materializer;
    }

    /** True when there are asset versions but no reference rows, the state the 015 cleanup leaves behind. */
    @Transactional(readOnly = true)
    public boolean isNeeded() {
        return references.count() == 0 && versions.count() > 0;
    }

    /** Rebuilds every asset's reference rows from its version history; returns the number of assets replayed. */
    @Transactional
    public int rebuildAll() {
        List<Asset> all = assets.findAll();
        for (Asset asset : all) {
            references.deleteAllInBatch(references.findByFromAssetId(asset.getId()));
            List<AssetVersion> history = versions.findByAssetIdOrderByValidFromRevisionDesc(asset.getId()).reversed();
            for (AssetVersion version : history) {
                materializer.materialize(asset, version);
            }
        }
        return all.size();
    }
}
