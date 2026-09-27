package com.acme.staticforge.api.dto;

import com.fasterxml.jackson.databind.JsonNode;

/**
 * A partial edit of a system job (M29.1.2); omitted members stay as they are. {@code cron} is a five-field cron
 * expression, {@code zone} an IANA zone id; {@code settings} is merged key by key into the job's settings (a
 * {@code null} value removes a key, which then fails validation when the job needs it).
 */
public record UpdateJobRequest(Boolean enabled, String cron, String zone, JsonNode settings) {}
