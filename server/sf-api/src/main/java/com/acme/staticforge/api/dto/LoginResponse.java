package com.acme.staticforge.api.dto;

/**
 * Successful auth response: the access token is returned in the JSON body (it is never
 * stored in a cookie); the refresh token travels separately as an HttpOnly cookie (spec
 * §9.1, §9.4).
 */
public record LoginResponse(String accessToken, String tokenType, long expiresIn) {}
