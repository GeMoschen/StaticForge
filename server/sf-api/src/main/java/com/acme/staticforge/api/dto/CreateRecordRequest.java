package com.acme.staticforge.api.dto;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.UUID;

/**
 * Create a record of a dataset (M19.2.1) in the record set {@code recordSetUuid} (M25) — required, a
 * record never lives outside a set of its dataset. {@code displayName} may be omitted when the dataset's
 * title editor has a value in {@code content}.
 */
public record CreateRecordRequest(UUID recordSetUuid, String displayName, JsonNode content, String comment) {}
