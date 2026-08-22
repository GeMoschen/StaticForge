package com.acme.staticforge.api.dto;

import com.fasterxml.jackson.databind.JsonNode;

/** Client-facing generation target (spec §18.4, §20.2). */
public record GenerationTargetView(Long id, String name, String type, JsonNode config, boolean isDefault) {}
