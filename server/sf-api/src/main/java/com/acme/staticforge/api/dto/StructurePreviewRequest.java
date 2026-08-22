package com.acme.staticforge.api.dto;

import java.util.UUID;

/** Structure preview request: compute the nav tree relative to an (optional) active page. */
public record StructurePreviewRequest(UUID pageUuid) {}
