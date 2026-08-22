package com.acme.staticforge.api.dto;

import com.fasterxml.jackson.databind.JsonNode;
import java.time.Instant;
import java.util.List;

/** Client-facing generation run summary (spec §18.5, §20.2). */
public record GenerationRunView(
        Long id,
        Long revisionId,
        String mode,
        List<String> channels,
        Long targetId,
        String status,
        Instant startedAt,
        Instant finishedAt,
        long filesWritten,
        long filesSkipped,
        long bytesWritten,
        int errorCount,
        int warningCount,
        JsonNode diagnostics) {}
