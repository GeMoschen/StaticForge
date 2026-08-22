package com.acme.staticforge.api.dto;

import com.fasterxml.jackson.databind.JsonNode;

/** Client request to update an output channel (spec §15.2). */
public record ChannelUpdateRequest(
        String name,
        String fileExtension,
        String defaultEscaping,
        boolean enabled,
        boolean isDefault,
        Integer position,
        JsonNode settings) {}
