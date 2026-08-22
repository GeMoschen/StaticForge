package com.acme.staticforge.api.dto;

/** Result of a project import (spec §26.5). */
public record ImportResultView(String sourceProjectKey, int importedAssetCount, int importedBlobCount) {}
