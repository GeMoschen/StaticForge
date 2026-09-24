package com.acme.staticforge.api.dto;

/**
 * {@code PATCH /api/v1/auth/me} (M26): a missing field stays as it is, a blank display name clears it. Changing the
 * username or email needs {@code currentPassword}; the display name does not.
 */
public record UpdateMeRequest(String displayName, String username, String email, String currentPassword) {}
