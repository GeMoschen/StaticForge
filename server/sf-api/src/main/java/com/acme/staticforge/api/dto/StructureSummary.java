package com.acme.staticforge.api.dto;

import java.util.UUID;

/** Listing summary of a structure's current version. */
public record StructureSummary(
        UUID uuid, String uid, String assetType, String displayName, String folderPath, long revision) {}
