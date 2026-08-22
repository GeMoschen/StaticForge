package com.acme.staticforge.channel;

import com.fasterxml.jackson.databind.JsonNode;

/** Domain command for creating an output channel (spec §15.2). {@code copyFrom} names the
 * channel whose per-template OCTL sources seed this channel's templates. */
public record CreateChannelRequest(
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
