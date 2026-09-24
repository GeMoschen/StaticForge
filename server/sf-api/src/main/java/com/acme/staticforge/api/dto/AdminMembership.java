package com.acme.staticforge.api.dto;

import java.time.Instant;

/** One membership of an account; {@code grantedBy} is the granting user's username. */
public record AdminMembership(
        String projectKey,
        String projectName,
        boolean archived,
        String role,
        Instant grantedAt,
        String grantedBy) {}
