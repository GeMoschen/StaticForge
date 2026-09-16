package com.acme.staticforge.api.dto;

import java.util.UUID;

/** One dataset in a list response (M19.2.1): identity, title editor and live record count. */
public record DatasetSummaryView(
        UUID uuid,
        String uid,
        String displayName,
        UUID folderUuid,
        String folderPath,
        String titleEditor,
        String description,
        long recordCount,
        long revision) {}
