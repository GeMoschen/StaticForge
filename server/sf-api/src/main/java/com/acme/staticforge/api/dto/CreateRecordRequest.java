package com.acme.staticforge.api.dto;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.UUID;

/**
 * Create a record of a dataset (M19.2.1) in the record set {@code recordSetUuid} (M25) — required, a
 * record never lives outside a set of its dataset. There is no name to give: the record's uid comes from its
 * uuid and its display name from the dataset's title editor, else the uuid (M25).
 */
public record CreateRecordRequest(UUID recordSetUuid, JsonNode content, String comment) {}
