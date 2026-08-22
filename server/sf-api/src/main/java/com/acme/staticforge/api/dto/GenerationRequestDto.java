package com.acme.staticforge.api.dto;

import com.acme.staticforge.generate.GenerationMode;
import java.util.List;
import java.util.UUID;

/**
 * Client request to start a generation run (spec §20.2). Mirrors
 * {@code com.acme.staticforge.generate.GenerationRequest} except the {@code Idempotency-Key},
 * which the controller reads from the request header itself.
 */
public record GenerationRequestDto(
        GenerationMode mode,
        Long revision,
        List<String> channels,
        Long targetId,
        String folderPath,
        List<UUID> assetUuids,
        String comment) {}
