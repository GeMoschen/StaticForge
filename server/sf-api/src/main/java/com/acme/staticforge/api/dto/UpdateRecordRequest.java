package com.acme.staticforge.api.dto;

import com.fasterxml.jackson.databind.JsonNode;

/**
 * Replace a record's values (M19.2.1). The display name follows the dataset's title editor value when it is
 * set and stays as it is otherwise; a record can't be renamed (M25).
 */
public record UpdateRecordRequest(JsonNode content, String comment) {}
