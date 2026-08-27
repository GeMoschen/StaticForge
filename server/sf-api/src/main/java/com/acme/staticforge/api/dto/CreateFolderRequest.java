package com.acme.staticforge.api.dto;

import java.util.UUID;

/**
 * Create-folder request body. {@code scope} ("PAGES", "MEDIA", "NAVIGATION", or "TEMPLATES")
 * is required for a root-level folder; a subfolder inherits its parent's scope. {@code
 * templateKind} ("PAGE_TEMPLATE" or "SECTION_TEMPLATE") is meaningful only under the {@code
 * TEMPLATES} scope and, like {@code scope}, is inherited from the parent when omitted.
 */
public record CreateFolderRequest(String displayName, UUID parentFolderUuid, String scope, String templateKind) {}
