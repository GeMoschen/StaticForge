package com.acme.staticforge.scheduler;

import java.util.List;
import java.util.UUID;

/**
 * What an action works on, for the schedules API (M27.4.4): its items with their current state and, for a pinned
 * release, the drift since it was scheduled (epic decision 22). Empty for actions without items (generation).
 *
 * @param driftCount pinned items whose draft changed since scheduling; {@code null} when the action isn't pinned
 */
public record ActionDescription(List<Item> items, Integer driftCount) {

    public static final ActionDescription NONE = new ActionDescription(List.of(), null);

    public ActionDescription {
        items = List.copyOf(items);
    }

    /**
     * One item.
     *
     * @param uid {@code null} when the asset no longer exists
     * @param pinnedVersionId the version a pinned release makes live; {@code null} for the draft at execution
     * @param draftChangedSinceScheduled {@code true} when the draft is no longer the pinned version; {@code null} when
     *     not pinned
     * @param status the item's current release status in its locale; {@code null} when the asset is gone
     */
    public record Item(
            UUID assetUuid,
            String assetType,
            String uid,
            String displayName,
            String locale,
            Long pinnedVersionId,
            Boolean draftChangedSinceScheduled,
            String status) {}
}
