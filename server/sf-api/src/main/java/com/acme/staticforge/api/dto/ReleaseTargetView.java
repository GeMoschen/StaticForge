package com.acme.staticforge.api.dto;

import java.util.UUID;

/**
 * One resolved (asset, locale) of a release request (M27.1.3). {@code status} is the status before the request
 * ({@code null} for a deleted asset released nowhere); {@code versionId} the version a release points at.
 */
public record ReleaseTargetView(
        UUID uuid, String type, String uid, String displayName, String locale, String status, Long versionId) {}
