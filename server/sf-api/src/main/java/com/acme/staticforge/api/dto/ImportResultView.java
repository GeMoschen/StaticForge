package com.acme.staticforge.api.dto;

/** Result of a project import (spec §26.5); {@code releasedCount} (M27.5.1): release pointers opened, one per asset and locale. */
public record ImportResultView(
        String sourceProjectKey, int importedAssetCount, int updatedAssetCount, int importedBlobCount, int releasedCount) {}
