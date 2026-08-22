package com.acme.staticforge.security;

import com.acme.staticforge.user.SystemRole;
import java.util.Collection;
import org.springframework.security.core.GrantedAuthority;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationToken;

/**
 * A {@link JwtAuthenticationToken} whose principal is the {@link AuthenticatedUser} derived
 * from the access-token claims (spec §9.2). Spring's stock token pins its principal to the
 * raw {@link Jwt}; we override {@link #getPrincipal()} so {@link SecuritySupport} can read
 * the materialized user directly.
 */
public class SfJwtAuthenticationToken extends JwtAuthenticationToken {

    private final AuthenticatedUser principal;

    public SfJwtAuthenticationToken(
            Jwt jwt, Collection<? extends GrantedAuthority> authorities, AuthenticatedUser principal) {
        super(jwt, authorities);
        this.principal = principal;
    }

    @Override
    public Object getPrincipal() {
        return principal;
    }

    public SystemRole systemRole() {
        return principal.systemRole();
    }
}
