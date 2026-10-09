package com.acme.staticforge.api.dto;

import com.fasterxml.jackson.databind.JsonNode;

/**
 * Client request to create/update a generation target (spec §18.4, §20.2). {@code baseUrl} is a convenience for
 * {@code config.baseUrl}, the public address of the published site: {@code null} leaves {@code config.baseUrl}
 * as sent, a value (an {@code http(s)} URL) overrides it, a blank value removes it.
 */
public record GenerationTargetRequest(String name, String type, JsonNode config, boolean isDefault, String baseUrl) {}
