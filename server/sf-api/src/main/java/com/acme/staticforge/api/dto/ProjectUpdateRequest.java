package com.acme.staticforge.api.dto;

import jakarta.validation.constraints.NotBlank;

/** Update-project request body (spec §20.2). */
public record ProjectUpdateRequest(@NotBlank String name, String description) {}
