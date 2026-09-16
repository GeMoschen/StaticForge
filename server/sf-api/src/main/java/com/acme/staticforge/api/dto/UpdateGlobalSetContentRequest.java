package com.acme.staticforge.api.dto;

import com.fasterxml.jackson.databind.JsonNode;

/** Replace a property set's values (M17.2.1). Requires {@code EDITOR} and an {@code If-Match}. */
public record UpdateGlobalSetContentRequest(JsonNode content, String comment) {}
