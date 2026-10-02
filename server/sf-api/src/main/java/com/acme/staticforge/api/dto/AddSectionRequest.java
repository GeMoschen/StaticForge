package com.acme.staticforge.api.dto;

import com.fasterxml.jackson.databind.JsonNode;

/**
 * Add-section request body. {@code instanceId} and {@code content} are optional (fresh id and empty content when
 * absent); sent together with {@code position} they re-insert a deleted section exactly as it was (undo).
 */
public record AddSectionRequest(String templateUuid, Integer position, String instanceId, JsonNode content) {}
