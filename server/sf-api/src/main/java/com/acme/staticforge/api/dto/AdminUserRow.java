package com.acme.staticforge.api.dto;

import java.time.Instant;

/** One row of the user listing. */
public record AdminUserRow(
        Long id,
        String username,
        String displayName,
        String email,
        String status,
        String systemRole,
        boolean mustChangePassword,
        Instant lastLoginAt,
        long projectCount) {}
