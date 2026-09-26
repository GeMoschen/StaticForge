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
     */
    public record FailingSchedule(
            long id, String type, Instant runAt, Long ownerUserId, String ownerName, String missingPermission) {}
}
