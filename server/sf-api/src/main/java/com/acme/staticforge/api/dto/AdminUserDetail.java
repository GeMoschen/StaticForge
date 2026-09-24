package com.acme.staticforge.api.dto;

import com.fasterxml.jackson.annotation.JsonInclude;
import java.time.Instant;
import java.util.List;

/**
 * The full account. {@code generatedPassword} is present only in the response to a create or password reset
 * that asked the server to generate one — it is shown once and never stored in clear.
 */
public record AdminUserDetail(
        Long id,
        String username,
        String displayName,
        String email,
        String status,
        String systemRole,
        boolean mustChangePassword,
        Instant lastLoginAt,
        long projectCount,
        Instant createdAt,
        int failedLogins,
        Instant lockedUntil,
        List<AdminMembership> memberships,
        @JsonInclude(JsonInclude.Include.NON_NULL) String generatedPassword) {}
