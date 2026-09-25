package com.acme.staticforge.api.dto;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

/**
 * One row of the Changes view (M27.1.3): an (asset, locale) whose status isn't {@code PUBLISHED}. {@code changedBy}
 * and {@code changedAt} describe the draft, the {@code released*} fields the current release ({@code null} when
 * nothing is released in that locale). {@code scheduled} lists the pending schedules touching the asset in that
 * locale (M27.4.4).
 */
public record ChangeRowView(
        UUID uuid,
        String type,
        String uid,
        String displayName,
        String folderPath,
        String locale,
        String status,
        Long changedBy,
        Instant changedAt,
        Long releasedRevision,
        Long releasedBy,
        Instant releasedAt,
        List<ScheduledRefView> scheduled) {}
