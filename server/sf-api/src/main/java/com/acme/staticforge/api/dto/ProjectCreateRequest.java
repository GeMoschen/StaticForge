package com.acme.staticforge.api.dto;

import jakarta.validation.constraints.NotBlank;

/** Create-project request body (spec §20.2). */
public record ProjectCreateRequest(@NotBlank String key, @NotBlank String name, String description) {}
