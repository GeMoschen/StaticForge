package com.acme.staticforge.api.dto;

import java.util.UUID;

/** One global property set in a list response (M17.2.1) — identity only, no schema or values. */
public record GlobalSetSummaryView(UUID uuid, String uid, String displayName, String folderPath, long revision, java.util.Map<String, LocaleReleaseView> release, java.util.List<ScheduledRefView> scheduled) {}
