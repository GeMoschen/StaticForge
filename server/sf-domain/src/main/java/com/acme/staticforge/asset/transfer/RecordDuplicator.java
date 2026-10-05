package com.acme.staticforge.asset.transfer;

import com.acme.staticforge.asset.AssetService;
import com.acme.staticforge.asset.AssetType;
import com.acme.staticforge.asset.AssetVersionView;
import com.acme.staticforge.asset.dataset.RecordService;
import com.acme.staticforge.revision.RevisionContext;
import org.springframework.stereotype.Component;

/** Records are copied by {@link RecordService}: the name comes from the title value, not from a sibling scan. */
@Component
class RecordDuplicator implements AssetDuplicator {

    private final RecordService records;
    private final AssetService assets;

    RecordDuplicator(RecordService records, AssetService assets) {
        this.records = records;
        this.assets = assets;
    }

    @Override
    public AssetType type() {
        return AssetType.RECORD;
    }

    @Override
    public AssetVersionView duplicate(AssetVersionView source, DuplicateTarget target, RevisionContext ctx) {
        var copy = records.duplicate(source.uuid(), target.parentUuid(), ctx).record();
        return assets.requireCurrent(ctx.projectId(), copy.uuid());
    }
}
