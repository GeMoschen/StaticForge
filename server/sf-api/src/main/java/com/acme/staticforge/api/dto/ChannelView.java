package com.acme.staticforge.api.dto;

import com.fasterxml.jackson.databind.JsonNode;

/** Client-facing output channel (spec §15.2, §20.2). */
public record ChannelView(
        String key,
        String name,
        String fileExtension,
        String mimeType,
        String defaultEscaping,
        boolean enabled,
        boolean isDefault,
        int position,
        JsonNode settings) {}
