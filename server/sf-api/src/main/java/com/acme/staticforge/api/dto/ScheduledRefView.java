package com.acme.staticforge.api.dto;

import java.time.Instant;

/**
 * A pending schedule touching an asset (M27.4.4), in the {@code scheduled} list of asset views and Changes rows.
 * {@code locale} is the locale key it touches ({@code ""} = every locale); {@code runAt} is {@code null} for a
 * recurring action.
 */
public record ScheduledRefView(long actionId, String type, String locale, Instant runAt, Instant nextRunAt) {}
