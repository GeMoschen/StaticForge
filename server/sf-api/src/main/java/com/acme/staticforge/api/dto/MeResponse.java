package com.acme.staticforge.api.dto;

import java.util.List;
import java.util.Map;

/**
 * Current-principal view returned by {@code GET /api/v1/auth/me} (spec §9.4). Read from the account row, not from
 * the token, so a rename or profile edit shows at once. {@code mustChangePassword} (M26) tells the client to route to
 * the password change: every other API call answers {@code 428} until then. {@code projectRoles} is what the access
 * token authorizes; {@code memberships} adds the project names (archived projects only for instance admins).
 */
public record MeResponse(
        Long id,
        String username,
        String displayName,
        String email,
        String systemRole,
        boolean mustChangePassword,
        Map<String, String> projectRoles,
        List<Membership> memberships) {

    /** One project the user is a member of. */
    public record Membership(String projectKey, String projectName, String role) {}
}
