package com.acme.staticforge.security;

import com.acme.staticforge.user.AppUser;

/**
 * Issues HS256-signed access tokens carrying the claim set defined in spec §9.2.
 */
public interface JwtService {

    /**
     * Issues a fresh access token for the given user. Project memberships are read from the
     * {@code ProjectMemberRepository} and embedded as the {@code projects} claim so that
     * downstream authorization is O(1) with no database round-trip (spec §9.2).
     */
    String issueAccessToken(AppUser user);
}
