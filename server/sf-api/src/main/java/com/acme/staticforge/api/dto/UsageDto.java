package com.acme.staticforge.api.dto;

import java.util.UUID;

/** One inbound reference to an asset. */
public record UsageDto(UUID fromUuid, String fromUid, String fromType, String kind, String sourcePath) {}
