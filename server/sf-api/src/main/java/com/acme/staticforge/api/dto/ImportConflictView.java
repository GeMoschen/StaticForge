package com.acme.staticforge.api.dto;

/** Client-facing single import conflict (spec §26.5, feature {@code import-conflicts}, M10.2.3). */
public record ImportConflictView(
        String severity, String type, String elementUuid, String elementLabel, String detail) {}
