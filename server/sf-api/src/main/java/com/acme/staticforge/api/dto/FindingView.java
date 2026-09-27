package com.acme.staticforge.api.dto;

import java.util.UUID;

/**
 * One stored quality check finding of a run (M30.1.2). {@code page} names the output's asset as it is now ({@code uid}
 * and {@code displayName} are {@code null} once it was deleted); {@code carried} marks a finding taken over from the
 * base build for an output the run carried forward.
 */
public record FindingView(
        long id,
        String code,
        String category,
        String severity,
        String message,
        String selector,
        String sectionInstanceId,
        boolean carried,
        String outputPath,
        String channel,
        String locale,
        Integer pageNumber,
        FindingAsset page) {

    /** The asset an output belongs to; {@code null} for a site file. */
    public record FindingAsset(UUID uuid, String uid, String displayName) {}
}
