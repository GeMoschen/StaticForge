package com.acme.staticforge.api.dto;

import java.time.Instant;
import java.util.List;

/**
 * What a proposed publish policy would break (M28.1.1): the pending schedules whose owner satisfies them now but
 * wouldn't under the proposal, so they would fail at execution ("creator no longer permitted").
 */
public record PublishPolicyImpactView(List<FailingSchedule> failingSchedules) {

    /**
     * @param runAt the next execution time
     * @param missingPermission what the owner would lose, e.g. {@code SCHEDULE_RELEASE}
     * @param itemName the display name of the first released or unpublished item; {@code null} for a schedule without
     *     items (generation)
     * @param itemCount how many items the schedule covers (0 for generation)
     */
    public record FailingSchedule(
            long id,
            String type,
            Instant runAt,
            Long ownerUserId,
            String ownerName,
            String missingPermission,
            String itemName,
            int itemCount) {}
}
