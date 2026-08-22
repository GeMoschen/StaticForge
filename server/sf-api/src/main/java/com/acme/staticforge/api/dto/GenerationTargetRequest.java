package com.acme.staticforge.api.dto;

import com.fasterxml.jackson.databind.JsonNode;

/** Client request to create/update a generation target (spec §18.4, §20.2). */
public record GenerationTargetRequest(String name, String type, JsonNode config, boolean isDefault) {}
