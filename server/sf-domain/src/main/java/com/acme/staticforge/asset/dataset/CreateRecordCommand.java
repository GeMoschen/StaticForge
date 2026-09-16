package com.acme.staticforge.asset.dataset;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.UUID;

/**
 * Command to create a dataset record (M19.1.2). {@code folderUuid} {@code null} means the Content
 * store root; {@code displayName} may be blank when the dataset has a title editor whose value is set.
 */
public record CreateRecordCommand(long projectId, UUID datasetUuid, UUID folderUuid, String displayName, JsonNode content) {}
