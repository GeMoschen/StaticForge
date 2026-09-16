package com.acme.staticforge.api.dto;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.UUID;

/**
 * Create a record of a dataset (M19.2.1). {@code folderUuid} omitted means the Content store root;
 * {@code displayName} may be omitted when the dataset's title editor has a value in {@code content}.
 */
public record CreateRecordRequest(UUID folderUuid, String displayName, JsonNode content, String comment) {}
