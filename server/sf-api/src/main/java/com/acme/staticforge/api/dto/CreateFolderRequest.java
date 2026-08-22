package com.acme.staticforge.api.dto;

import java.util.UUID;

/** Create-folder request body. */
public record CreateFolderRequest(String displayName, UUID parentFolderUuid) {}
