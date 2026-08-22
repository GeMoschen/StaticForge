package com.acme.staticforge.api.dto;

import java.util.UUID;

/** Create-page request body. */
public record CreatePageRequest(String displayName, UUID folderUuid, UUID templateUuid) {}
