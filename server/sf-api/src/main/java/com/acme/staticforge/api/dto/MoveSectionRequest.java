package com.acme.staticforge.api.dto;

import java.util.UUID;

/** Move-section-between-bodies request body; the target page/body come from the URL path. */
public record MoveSectionRequest(UUID sourcePageUuid, String sourceBody, String instanceId, Integer position) {}
