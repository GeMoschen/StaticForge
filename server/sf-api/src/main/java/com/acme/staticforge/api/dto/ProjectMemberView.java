package com.acme.staticforge.api.dto;

import java.time.Instant;

/**
 * Membership view enriched with user info (spec §20.2). {@code email} is {@code null} unless the caller is a
 * {@code PROJECT_ADMIN} of the project or an instance admin (M26); {@code status} lets clients grey out disabled
 * members, who keep their membership while disabled.
 */
public record ProjectMemberView(
        Long userId,
        String username,
        String displayName,
        String email,
        String status,
        String role,
        Instant grantedAt,
        Long grantedBy) {}
