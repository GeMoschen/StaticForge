package com.acme.staticforge.api.dto;

import com.fasterxml.jackson.databind.JsonNode;

/**
 * Replace a record's values (M19.2.1). {@code displayName} renames the record only when its dataset
 * has no title editor; omit it to keep the current name.
 */
public record UpdateRecordRequest(JsonNode content, String displayName, String comment) {}
