package com.acme.staticforge.scheduler;

import java.time.Instant;
import java.util.UUID;

/**
 * An active scheduled action touching an asset (M27.4.4) — one entry of the {@code scheduled} block of asset views
 * and Changes rows.
 *
 * @param locale the locale key the action touches, {@code ""} for every locale
 * @param runAt the one-off time; {@code null} for a recurring action
 * @param nextRunAt when it is next due
 */
public record ScheduledRef(UUID assetUuid, String locale, long actionId, String type, Instant runAt, Instant nextRunAt) {}
