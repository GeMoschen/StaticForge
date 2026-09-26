package com.acme.staticforge.exportimport;

import com.fasterxml.jackson.annotation.JsonInclude;
import java.time.Instant;
import java.util.List;

/**
 * An open schedule in an export archive (M27.8.1, protocol {@code 9}): {@code schedules/<uuid>.json}. It holds no
 * database id: assets are named by uuid, a pinned version by its content ({@link ExportedRelease}), a generation
 * target by {@link ExportedTargetRef}, and users by username.
 *
 * @param uuid the schedule's identity; a re-import replaces the open schedule with the same uuid
 * @param type the handler type: {@code RELEASE}, {@code UNPUBLISH}, {@code GENERATION} or {@code RECURRING_GENERATION}
 * @param status {@code PENDING}, or {@code FAILED} for a paused recurring schedule
 * @param ownerUsername the owner, {@code null} for a deleted account
 * @param createdByUsername the creator, {@code null} for a deleted account
 * @param items what a release or unpublish works on; {@code null} for a generation
 * @param thenGenerate the build after a release or unpublish; {@code null} when there is none
 * @param generation what a generation builds; {@code null} for a release or unpublish
 */
@JsonInclude(JsonInclude.Include.NON_NULL)
public record ExportedSchedule(
        String uuid,
        String type,
        String status,
        Instant runAt,
        String cron,
        String zoneId,
        String pinPolicy,
        String missedPolicy,
        Long maxLatenessSeconds,
        String ownerUsername,
        String createdByUsername,
        Instant createdAt,
        String comment,
        List<ExportedScheduleItem> items,
        ExportedThenGenerate thenGenerate,
        ExportedGeneration generation) {

    /**
     * One (asset, locale key) of a release or unpublish.
     *
     * @param locale the locale key, {@code ""} for the shared key
     * @param deletion a scheduled deletion: releasing it takes the asset offline
     * @param pin the version a pinned release makes live — {@link ExportedRelease.State#DRAFT_EQUALS} when it is the
     *     exported draft, else {@link ExportedRelease.State#PAYLOAD} with its content; {@code null} for a latest
     *     release, an unpublish and a deletion
     */
    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record ExportedScheduleItem(String assetUuid, String locale, Boolean deletion, ExportedRelease pin) {}

    /**
     * A generation target as a schedule names it: its uuid, and its name for a target that an import skips for a name
     * clash. {@code missing}: the target was deleted in the source, so the schedule can't run as it is. A {@code null}
     * reference (not this record) is the project's default target.
     */
    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record ExportedTargetRef(String uuid, String name, Boolean missing) {}

    /** The build after a release or unpublish. */
    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record ExportedThenGenerate(ExportedTargetRef target, List<String> channels) {}

    /** What a scheduled generation builds: {@code folderPath} and {@code assetUuids} narrow it to a scope. */
    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record ExportedGeneration(
            String mode, List<String> channels, ExportedTargetRef target, String folderPath, List<String> assetUuids) {}
}
