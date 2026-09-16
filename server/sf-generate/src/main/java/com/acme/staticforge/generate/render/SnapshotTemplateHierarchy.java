package com.acme.staticforge.generate.render;

import com.acme.staticforge.asset.AssetType;
import com.acme.staticforge.asset.template.TemplateCompileMemo;
import com.acme.staticforge.asset.template.TemplateHierarchy;
import com.acme.staticforge.generate.snapshot.Snapshot;
import java.util.Optional;

/**
 * The page templates of a generation snapshot as a {@link TemplateHierarchy} (M20): the build's single source of
 * ancestors for chain compilation and effective definitions, so generation links exactly the chain preview links
 * at the same revision. One per build, held by the build's compile memo; definitions come from that memo too.
 */
final class SnapshotTemplateHierarchy {

    private SnapshotTemplateHierarchy() {}

    static TemplateHierarchy of(Snapshot snapshot, TemplateCompileMemo memo) {
        return memo.hierarchy(() -> new TemplateHierarchy(uuid -> Optional.ofNullable(snapshot.assetByUuid(uuid))
                .filter(asset -> asset.type() == AssetType.PAGE_TEMPLATE && !asset.deleted())
                .map(asset -> new TemplateHierarchy.TemplateVersion(
                        asset.uuid(),
                        asset.uid(),
                        asset.payload(),
                        memo.definition(asset.uuid(), asset.payload().path("contentDefinition").asText("")),
                        0))));
    }
}
