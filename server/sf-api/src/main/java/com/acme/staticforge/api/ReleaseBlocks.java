package com.acme.staticforge.api;

import com.acme.staticforge.api.dto.LocaleReleaseView;
import com.acme.staticforge.api.dto.ScheduledRefView;
import com.acme.staticforge.release.LocaleRelease;
import com.acme.staticforge.release.ReleaseStatusService;
import com.acme.staticforge.scheduler.ScheduleService;
import java.util.Collection;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.stereotype.Component;

/**
 * Builds the {@code release} block every releasable asset view carries (M27.1.3): the status per locale key, and its
 * {@code scheduled} list (M27.4.4): the pending schedules touching the asset. Lists and trees use the
 * {@link Collection} overloads once per response, never per row.
 */
@Component
class ReleaseBlocks {

    private final ReleaseStatusService statuses;
    private final ScheduleService schedules;

    ReleaseBlocks(ReleaseStatusService statuses, ScheduleService schedules) {
        this.statuses = statuses;
        this.schedules = schedules;
    }

    /** The block of one asset; {@code null} when it has no release state (a template, a store root). */
    Map<String, LocaleReleaseView> of(long projectId, UUID uuid) {
        return of(projectId, java.util.List.of(uuid)).get(uuid);
    }

    /** The blocks of several assets, keyed by uuid; assets without a release state are absent. */
    Map<UUID, Map<String, LocaleReleaseView>> of(long projectId, Collection<UUID> uuids) {
        Map<UUID, Map<String, LocaleReleaseView>> out = new LinkedHashMap<>();
        statuses.ofUuids(projectId, uuids).forEach((uuid, locales) -> out.put(uuid, view(locales)));
        return out;
    }

    /** The pending schedules touching one asset (empty when none). */
    List<ScheduledRefView> scheduled(long projectId, UUID uuid) {
        return scheduled(projectId, List.of(uuid)).getOrDefault(uuid, List.of());
    }

    /** The pending schedules touching each of {@code uuids}; assets without any are absent. */
    Map<UUID, List<ScheduledRefView>> scheduled(long projectId, Collection<UUID> uuids) {
        Map<UUID, List<ScheduledRefView>> out = new LinkedHashMap<>();
        schedules.scheduledFor(projectId, uuids).forEach((uuid, refs) -> out.put(uuid, refs.stream()
                .map(r -> new ScheduledRefView(r.actionId(), r.type(), r.locale(), r.runAt(), r.nextRunAt()))
                .toList()));
        return out;
    }

    static Map<String, LocaleReleaseView> view(Map<String, LocaleRelease> locales) {
        Map<String, LocaleReleaseView> view = new LinkedHashMap<>();
        locales.forEach((key, release) -> view.put(key, new LocaleReleaseView(
                release.status().name(), release.releasedRevision(), release.releasedAt(), release.releasedBy())));
        return view;
    }
}
