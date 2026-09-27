package com.acme.staticforge.revision;

import java.util.List;
import java.util.UUID;

/**
 * The diff of one touched asset between two revisions.
 *
 * @param action for a compacted asset, the action the revision's summary recorded
 * @param changes empty for a compacted asset
 * @param compacted revision compaction absorbed this asset's exact state at the revision or right before it (M29.4.3):
 *     the change can't be shown, only that the asset was touched
 */
public record AssetDiff(
        UUID uuid, String uid, String type, String action, List<FieldChange> changes, boolean compacted) {

    /** An exact diff. */
    public AssetDiff(UUID uuid, String uid, String type, String action, List<FieldChange> changes) {
        this(uuid, uid, type, action, changes, false);
    }
}
