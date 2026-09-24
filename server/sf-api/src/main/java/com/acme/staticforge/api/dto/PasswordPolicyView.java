package com.acme.staticforge.api.dto;

/** {@code GET /api/v1/auth/password-policy} (M26, public): the rules a new password must meet. */
public record PasswordPolicyView(int minLength, boolean requireMixed, int maxBytes) {}
