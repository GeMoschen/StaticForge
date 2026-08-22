package com.acme.staticforge.api.dto;

import jakarta.validation.constraints.NotBlank;

/** Set-member-role request body (spec §20.2). */
public record SetMemberRoleRequest(@NotBlank String role) {}
