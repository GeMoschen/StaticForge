package com.acme.staticforge.api.dto;

/** CDL validation request body (spec §14.7). */
public record CdlValidateRequest(String source) {}
