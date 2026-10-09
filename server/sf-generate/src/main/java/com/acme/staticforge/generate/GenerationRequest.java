package com.acme.staticforge.generate;

import java.util.List;
import java.util.UUID;

/**
 * The orchestrator's request payload for a single generation run (spec §18.5, §20.1). The
 * {@code projectKey} and acting user are supplied separately to {@link GenerationService#start};
 * {@code idempotencyKey} is the client's {@code Idempotency-Key} header value (optional, deduped
 * in-memory per JVM). {@code trigger} (M35.24) is what started the run; {@code null} reads as
 * {@link GenerationTrigger#MANUAL}.
 */
public record GenerationRequest(
        GenerationMode mode,
        Long revision,
        List<String> channels,
        Long targetId,
        String folderPath,
        List<UUID> assetUuids,
        String comment,
        String idempotencyKey,
        GenerationTrigger trigger) {

    /** A manually started request. */
    public GenerationRequest(
            GenerationMode mode,
            Long revision,
            List<String> channels,
            Long targetId,
            String folderPath,
            List<UUID> assetUuids,
            String comment,
            String idempotencyKey) {
        this(mode, revision, channels, targetId, folderPath, assetUuids, comment, idempotencyKey, GenerationTrigger.MANUAL);
    }

    public GenerationRequest {
        trigger = trigger == null ? GenerationTrigger.MANUAL : trigger;
    }
}
