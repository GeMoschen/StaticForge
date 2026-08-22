package com.acme.staticforge.generate;

import com.fasterxml.jackson.databind.JsonNode;

/**
 * A single progress event emitted over Server-Sent-Events during a generation run (spec §18.5,
 * §20.2). Serialized as the {@code data} payload of a {@code progress} named SSE event.
 */
public record RunEvent(
        String stage, String message, long filesWritten, int errors, int warnings, JsonNode diagnostics) {}
