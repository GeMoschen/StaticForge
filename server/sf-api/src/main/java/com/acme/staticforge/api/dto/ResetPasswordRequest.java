package com.acme.staticforge.api.dto;

/**
 * {@code POST /admin/users/{id}/password}. Exactly one of {@code password} or {@code generatePassword: true};
 * {@code mustChangePassword} defaults to {@code true}.
 */
public record ResetPasswordRequest(String password, Boolean generatePassword, Boolean mustChangePassword) {}
