package com.acme.staticforge.api.dto;

import java.util.List;

/**
 * {@code POST /admin/users}. Exactly one of {@code password} or {@code generatePassword: true};
 * {@code systemRole} defaults to {@code USER}, {@code mustChangePassword} to {@code true}.
 */
public record CreateUserRequest(
        String username,
        String email,
        String displayName,
        String systemRole,
        String password,
        Boolean generatePassword,
        Boolean mustChangePassword,
        List<MembershipRequest> memberships) {

    /** An initial membership of the new account. */
    public record MembershipRequest(String projectKey, String role) {}
}
