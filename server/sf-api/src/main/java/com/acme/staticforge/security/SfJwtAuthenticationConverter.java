package com.acme.staticforge.security;

import com.acme.staticforge.project.ProjectRole;
import com.acme.staticforge.user.AppUser;
import com.acme.staticforge.user.SystemRole;
import com.acme.staticforge.user.UserService;
import com.acme.staticforge.user.UserStatus;
import java.util.Collection;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.core.convert.converter.Converter;
import org.springframework.security.core.GrantedAuthority;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.server.resource.InvalidBearerTokenException;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationToken;
import org.springframework.stereotype.Component;

/**
 * Converts a validated {@link Jwt} into a {@link SfJwtAuthenticationToken} carrying the
 * {@link AuthenticatedUser} principal (spec §9.2). Parses {@code uid}/{@code sub}, {@code
 * preferred_username}, {@code name}, {@code sysRole} and the {@code projects} map, and
 * grants {@code SYS_INSTANCE_ADMIN} for instance administrators.
 *
 * <p>The token {@code epoch} claim is checked against the user's current {@code tokenEpoch}
 * so that password changes / membership removals immediately reject previously issued
 * tokens (spec §9.2: {@code bumpTokenEpoch}).
 */
@Component
public class SfJwtAuthenticationConverter implements Converter<Jwt, JwtAuthenticationToken> {

    private static final String AUTHORITY_INSTANCE_ADMIN = "SYS_INSTANCE_ADMIN";

    private final UserService userService;

    public SfJwtAuthenticationConverter(UserService userService) {
        this.userService = userService;
    }

    @Override
    public JwtAuthenticationToken convert(Jwt jwt) {
        Long id = readUserId(jwt);
        String username = firstNonBlank(jwt.getClaimAsString("preferred_username"), jwt.getSubject());
        String displayName = firstNonBlank(jwt.getClaimAsString("name"), username);
        SystemRole systemRole = parseSystemRole(jwt);
        Map<String, ProjectRole> projectRoles = parseProjects(jwt);

        AppUser user = userService.findById(id).orElseThrow(() -> new InvalidBearerTokenException("Unknown user: " + id));
        if (user.getStatus() == UserStatus.DISABLED || user.getStatus() == UserStatus.DELETED) {
            throw new InvalidBearerTokenException("User is disabled.");
        }
        Object epoch = jwt.getClaim("epoch");
        if (!(epoch instanceof Number number) || number.longValue() != user.getTokenEpoch()) {
            throw new InvalidBearerTokenException("Token epoch is stale.");
        }

        AuthenticatedUser principal = new AuthenticatedUser(
                id, username, displayName, systemRole, projectRoles, user.isMustChangePassword());

        Collection<GrantedAuthority> authorities =
                systemRole == SystemRole.INSTANCE_ADMIN
                        ? List.of(new SimpleGrantedAuthority(AUTHORITY_INSTANCE_ADMIN))
                        : List.of();

        return new SfJwtAuthenticationToken(jwt, authorities, principal);
    }

    private static Long readUserId(Jwt jwt) {
        Object uid = jwt.getClaim("uid");
        if (uid instanceof Number number) {
            return number.longValue();
        }
        String sub = jwt.getSubject();
        if (sub != null) {
            try {
                return Long.parseLong(sub);
            } catch (NumberFormatException ignored) {
                // fall through
            }
        }
        throw new InvalidBearerTokenException("Missing user identifier claim.");
    }

    private static SystemRole parseSystemRole(Jwt jwt) {
        String raw = jwt.getClaimAsString("sysRole");
        if (raw == null) {
            return SystemRole.USER;
        }
        try {
            return SystemRole.valueOf(raw);
        } catch (IllegalArgumentException ignored) {
            return SystemRole.USER;
        }
    }

    private static Map<String, ProjectRole> parseProjects(Jwt jwt) {
        Object raw = jwt.getClaim("projects");
        if (!(raw instanceof Map<?, ?> map)) {
            return Map.of();
        }
        Map<String, ProjectRole> roles = new LinkedHashMap<>();
        map.forEach((k, v) -> {
            if (k == null || v == null) {
                return;
            }
            try {
                roles.put(String.valueOf(k), ProjectRole.fromName(String.valueOf(v)));
            } catch (IllegalArgumentException ignored) {
                // unknown role name: skip rather than fail the token
            }
        });
        return roles;
    }

    private static String firstNonBlank(String primary, String fallback) {
        return primary != null && !primary.isBlank() ? primary : fallback;
    }
}
