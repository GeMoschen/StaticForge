package com.acme.staticforge.api.dto;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.List;
import java.util.UUID;

/**
 * An unsaved value to evaluate in the {@code edit} scope (M33.5). {@code kind} is {@code PAGE}, {@code SECTION},
 * {@code RECORD} or {@code GLOBAL_SET}; the definition comes from {@code templateUid} (page or section template),
 * {@code datasetUid} or {@code globalSetUid}, else from the stored asset {@code assetUuid}, which also gives the
 * rules their {@code meta} and {@code release}. {@code bodies} are a page's sections. {@code locale} limits evaluation
 * to the editing language (and the default one); omitted, every project language is evaluated. {@code changedPaths}
 * is a hint the server may ignore.
 */
public record RuleEvaluationRequest(
        String kind,
        UUID assetUuid,
        String templateUid,
        String datasetUid,
        String globalSetUid,
        JsonNode content,
        JsonNode bodies,
        String locale,
        List<String> changedPaths) {}
