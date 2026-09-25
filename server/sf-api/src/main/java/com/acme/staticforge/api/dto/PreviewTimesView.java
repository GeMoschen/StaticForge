package com.acme.staticforge.api.dto;

import java.time.Instant;
import java.util.List;

/** The next run instants of {@code cron} (normalized to six fields) in {@code zoneId} (M27.4.4). */
public record PreviewTimesView(String cron, String zoneId, List<Instant> times) {}
