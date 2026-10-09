package com.acme.staticforge.api.dto;

import com.acme.staticforge.generate.GenerationMode;
import com.acme.staticforge.generate.GenerationTrigger;
import java.util.List;
import java.util.UUID;

/**
 * Client request to start a generation run (spec §20.2). Mirrors
 * {@code com.acme.staticforge.generate.GenerationRequest} except the {@code Idempotency-Key},
 * which the controller reads from the request header itself. {@code trigger} (M35.24) says what started the run:
 * {@code MANUAL} (the default) or {@code RELEASE} (the build offered after a release); {@code SCHEDULE} is the
 * scheduler's and is refused with {@code 400}.
 */
public record GenerationRequestDto(
        GenerationMode mode,
        Long revision,
        List<String> channels,
        Long targetId,
        String folderPath,
        List<UUID> assetUuids,
        String comment,
        GenerationTrigger trigger) {

    /** A request without a trigger (manual). */
    public GenerationRequestDto(
            GenerationMode mode,
            Long revision,
            List<String> channels,
            Long targetId,
            String folderPath,
            List<UUID> assetUuids,
            String comment) {
        this(mode, revision, channels, targetId, folderPath, assetUuids, comment, null);
    }
}
