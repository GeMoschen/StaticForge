package com.acme.staticforge.api.dto;

/** The next run times of a cron in a zone (M27.4.4); {@code count} defaults to 5, at most 10. */
public record PreviewTimesRequest(String cron, String zoneId, Integer count) {}
