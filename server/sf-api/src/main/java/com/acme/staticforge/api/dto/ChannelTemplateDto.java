package com.acme.staticforge.api.dto;

import com.fasterxml.jackson.databind.JsonNode;

/** A single compiled channel template as stored on a section/page template. */
public record ChannelTemplateDto(String channelKey, String source, String compiledHash, JsonNode compiled) {}
