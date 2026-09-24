package com.acme.staticforge.security;

import com.acme.staticforge.project.ProjectRole;
import com.acme.staticforge.user.SystemRole;
import java.util.Map;

/**
 * The authenticated principal stored in the security context (spec §9.1/§9.2). Built by
 * {@code SfJwtAuthenticationConverter} from the access-token claims so project
 * authorization is O(1) with no DB round-trip. {@code mustChangePassword} is the one field read from the account row
 * the converter loads anyway, never from a claim: a forced password change applies to tokens issued before it.
 */
public record AuthenticatedUser(
        Long id,
        String username,
        String displayName,
        SystemRole systemRole,
        Map<String, ProjectRole> projectRoles,
        boolean mustChangePassword) {

    public boolean isInstanceAdmin() {
        return systemRole == SystemRole.INSTANCE_ADMIN;
    }
}
