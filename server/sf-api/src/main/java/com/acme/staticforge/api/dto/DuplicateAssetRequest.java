package com.acme.staticforge.api.dto;

import java.util.UUID;

/** Duplicate request body: the target folder (a record set for a record); {@code null} or absent is the asset's own folder. */
public record DuplicateAssetRequest(UUID folderUuid) {}
