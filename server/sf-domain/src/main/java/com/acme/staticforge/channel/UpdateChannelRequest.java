package com.acme.staticforge.channel;

import com.fasterxml.jackson.databind.JsonNode;

/** Domain command for updating an output channel (spec §15.2). */
public record UpdateChannelRequest(
        String name,
        String fileExtension,
        String mimeType,
        String defaultEscaping,
        boolean enabled,
        boolean isDefault,
        Integer position,
        JsonNode settings) {}
