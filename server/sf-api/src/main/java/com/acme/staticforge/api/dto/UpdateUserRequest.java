package com.acme.staticforge.api.dto;

/** {@code PATCH /admin/users/{id}}: a missing field stays as it is; a blank display name clears it. */
public record UpdateUserRequest(String username, String email, String displayName) {}
