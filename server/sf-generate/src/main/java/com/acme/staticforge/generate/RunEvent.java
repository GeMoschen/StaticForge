package com.acme.staticforge.generate;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.annotation.JsonInclude;

/**
 * A single progress event emitted over Server-Sent-Events during a generation run (spec §18.5,
 * §20.2). Serialized as the {@code data} payload of a {@code progress} named SSE event.
 *
 * <p>Since M35.24 an event is also a line of the run's log: {@code n} (its number, from 1), {@code time} (ISO-8601 UTC)
 * and {@code level} ({@code info}, {@code warning}, {@code error}) are the line's, absent on the {@code STATUS} event
 * sent on subscribing. A subscriber to a running run first gets the lines so far as the same events, so it de-duplicates
 * by {@code n}.
 */
public record RunEvent(
        String stage,
        String message,
        long filesWritten,
        int errors,
        int warnings,
        JsonNode diagnostics,
        @JsonInclude(JsonInclude.Include.NON_NULL) Integer n,
        @JsonInclude(JsonInclude.Include.NON_NULL) String time,
        @JsonInclude(JsonInclude.Include.NON_NULL) String level) {

    /** The event of a log line. */
    public static RunEvent of(RunLogStore.Line line, JsonNode diagnostics) {
        return new RunEvent(line.stage(), line.text(), line.files(), line.errors(), line.warnings(), diagnostics,
                line.n(), line.time().toString(), line.level());
    }
}
