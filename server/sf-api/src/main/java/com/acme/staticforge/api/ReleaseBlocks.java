package com.acme.staticforge.api;

import com.acme.staticforge.api.dto.LocaleReleaseView;
import com.acme.staticforge.release.LocaleRelease;
import com.acme.staticforge.release.ReleaseStatusService;
import java.util.Collection;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;
import org.springframework.stereotype.Component;

/**
 * Builds the {@code release} block every releasable asset view carries (M27.1.3): the status per locale key. Lists
 * and trees use {@link #of(long, Collection)} once per response, never per row.
 */
@Component
class ReleaseBlocks {

    private final ReleaseStatusService statuses;

    ReleaseBlocks(ReleaseStatusService statuses) {
        this.statuses = statuses;
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

    static Map<String, LocaleReleaseView> view(Map<String, LocaleRelease> locales) {
        Map<String, LocaleReleaseView> view = new LinkedHashMap<>();
        locales.forEach((key, release) -> view.put(key, new LocaleReleaseView(
                release.status().name(), release.releasedRevision(), release.releasedAt(), release.releasedBy())));
        return view;
    }
}
