package com.acme.staticforge.api.dto;

/** One hit of the member lookup {@code GET /users/lookup}; never carries an email. */
public record UserLookupHit(Long id, String username, String displayName, boolean member) {}
