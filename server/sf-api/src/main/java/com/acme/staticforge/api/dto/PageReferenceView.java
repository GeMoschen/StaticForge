package com.acme.staticforge.api.dto;

import java.util.UUID;

/**
 * Full {@code PageReference} representation (§ M8.1.5), mirroring {@code PageView}'s shape
 * conventions. {@code label} is the value resolved for the requested (or default) language, so
 * clients written before M24 keep working; {@code labelL10n} carries the per-language values and
 * is {@code null} in a project without locales (M24.2.2).
 */
public record PageReferenceView(
        UUID uuid,
        String uid,
        String displayName,
        long revision,
        String folderPath,
        String targetKind,
        UUID targetAssetUuid,
        String label,
        java.util.Map<String, String> labelL10n) {}
