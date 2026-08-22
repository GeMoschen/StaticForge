package com.acme.staticforge.api.dto;

/** OCTL validation request body (spec §20.2). */
public record OctlValidateRequest(String source, String channelKey, String templateUuid) {}
