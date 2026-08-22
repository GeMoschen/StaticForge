package com.acme.staticforge.api.dto;

import java.util.Map;

/** Current-principal view returned by {@code GET /api/v1/auth/me} (spec §9.4). */
public record MeResponse(
        Long id, String username, String displayName, String systemRole, Map<String, String> projectRoles) {}
