package com.acme.staticforge.api.dto;

import com.fasterxml.jackson.databind.JsonNode;

/**
 * Replace a property set's CDL (M17.2.1), as its content and rules sections (M34). Requires {@code DEVELOPER} and an
 * {@code If-Match}. {@code content} (optional, M34) saves the values edited against the stored schema in the same
 * revision; they are then migrated into the new schema — the editor's one Save.
 */
public record UpdateGlobalSetSchemaRequest(String contentCdl, String rulesCdl, JsonNode content, String comment) {}
