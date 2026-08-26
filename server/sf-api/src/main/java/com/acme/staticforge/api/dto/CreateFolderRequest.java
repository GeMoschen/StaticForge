package com.acme.staticforge.api.dto;

import java.util.UUID;

/** Create-folder request body. {@code scope} ("PAGES", "MEDIA", or "NAVIGATION") is required for a root-level folder; a subfolder inherits its parent's scope. */
public record CreateFolderRequest(String displayName, UUID parentFolderUuid, String scope) {}
