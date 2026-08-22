package com.acme.staticforge.api.dto;

import jakarta.validation.constraints.NotBlank;

/** Change-password request body (spec §9.4). */
public record ChangePasswordRequest(
        @NotBlank String currentPassword, @NotBlank String newPassword) {}
