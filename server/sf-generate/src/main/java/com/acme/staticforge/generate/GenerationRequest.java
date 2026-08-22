package com.acme.staticforge.generate;

import java.util.List;
import java.util.UUID;

/**
 * The orchestrator's request payload for a single generation run (spec §18.5, §20.1). The
 * {@code projectKey} and acting user are supplied separately to {@link GenerationService#start};
 * {@code idempotencyKey} is the client's {@code Idempotency-Key} header value (optional, deduped
 * in-memory per JVM).
 */
public record GenerationRequest(
        GenerationMode mode,
        Long revision,
        List<String> channels,
        Long targetId,
        String folderPath,
        List<UUID> assetUuids,
        String comment,
        String idempotencyKey) {}
