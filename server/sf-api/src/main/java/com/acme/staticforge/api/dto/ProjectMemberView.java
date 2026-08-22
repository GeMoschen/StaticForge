package com.acme.staticforge.api.dto;

import java.time.Instant;

/** Membership view enriched with user info (spec §20.2). */
public record ProjectMemberView(
        Long userId,
        String username,
        String displayName,
        String email,
        String role,
        Instant grantedAt,
        Long grantedBy) {}
