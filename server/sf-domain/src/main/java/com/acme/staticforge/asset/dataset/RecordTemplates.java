package com.acme.staticforge.asset.dataset;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.Map;
import java.util.Optional;
import java.util.TreeMap;

/**
 * A dataset's per-channel record templates (M25.2.1) as stored in its payload: {@code channelTemplates.<channel>}
 * holds {@code {source, compiledHash}} exactly like a section template's channel, next to the CDL schema. A channel
 * without an entry, or with a blank source, has no record template.
 *
 * <p>Rendering reads the source through {@link #source} and compiles it through the shared compile tiers —
 * {@code TemplateCompileMemo.compileRecordTemplate} in generation, {@code CompiledTemplateCache.compileRecordTemplate}
 * in preview — never with a compiler of its own.
 */
public final class RecordTemplates {

    /** The payload field holding the record templates, keyed by channel. */
    public static final String PAYLOAD_FIELD = "channelTemplates";

    private RecordTemplates() {}

    /** The record template source of {@code channel}; empty when the dataset has none for it. */
    public static Optional<String> source(JsonNode datasetPayload, String channel) {
        if (datasetPayload == null || channel == null) {
            return Optional.empty();
        }
        JsonNode source = datasetPayload.path(PAYLOAD_FIELD).path(channel).path("source");
        return source.isTextual() && !source.asText().isBlank() ? Optional.of(source.asText()) : Optional.empty();
    }

    /** Every stored record template source by channel key, in key order. */
    public static Map<String, String> sources(JsonNode datasetPayload) {
        Map<String, String> sources = new TreeMap<>();
        JsonNode channels = datasetPayload == null ? null : datasetPayload.get(PAYLOAD_FIELD);
        if (channels != null && channels.isObject()) {
            channels.fieldNames().forEachRemaining(channel -> source(datasetPayload, channel)
                    .ifPresent(source -> sources.put(channel, source)));
        }
        return sources;
    }
}
