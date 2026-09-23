package com.acme.staticforge.api.dto;

import java.util.Map;
import java.util.UUID;

/**
 * Create a dataset schema (M19.2.1). {@code parentFolderUuid} may be omitted: the dataset lands in the
 * fixed {@code datasets} folder. {@code titleEditor} optionally names a {@code text} editor whose
 * value becomes each record's display name. {@code channelTemplates} (optional, M25.2.1) maps an output
 * channel key to the OCTL record template a record renders with in that channel.
 */
public record CreateDatasetRequest(
        UUID parentFolderUuid,
        String displayName,
        String contentDefinition,
        String titleEditor,
        String description,
        Map<String, String> channelTemplates,
        String comment) {}
