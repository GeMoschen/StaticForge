package com.acme.staticforge.api.dto;

/** Replace a property set's CDL (M17.2.1). Requires {@code DEVELOPER} and an {@code If-Match}. */
public record UpdateGlobalSetSchemaRequest(String contentDefinition, String comment) {}
