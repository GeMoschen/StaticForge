package com.acme.staticforge.api.dto;

import com.fasterxml.jackson.databind.JsonNode;

/** Client request to create an output channel (spec §15.2). {@code copyFrom} names the channel
 * whose per-template OCTL sources seed this channel. */
public record ChannelCreateRequest(
        String key,
        String name,
        String fileExtension,
        String mimeType,
        String defaultEscaping,
        boolean enabled,
        boolean isDefault,
        Integer position,
        JsonNode settings,
        String copyFrom) {}
