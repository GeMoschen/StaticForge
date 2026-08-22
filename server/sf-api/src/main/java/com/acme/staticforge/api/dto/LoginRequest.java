package com.acme.staticforge.api.dto;

import jakarta.validation.constraints.NotBlank;

/** Login request body (spec §9.4). */
public record LoginRequest(@NotBlank String username, @NotBlank String password) {}
