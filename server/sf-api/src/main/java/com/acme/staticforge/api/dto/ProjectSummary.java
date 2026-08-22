package com.acme.staticforge.api.dto;

/** Listing summary of a project, including the caller's role (spec §20.2). */
public record ProjectSummary(
        String key, String name, String description, String yourRole, boolean archived) {}
