package com.acme.staticforge.api.dto;

import java.util.UUID;

/**
 * Create a global property set (M17.2.1). {@code parentFolderUuid} may be omitted, in which case
 * the set lands in the project's fixed {@code globals_root} folder.
 */
public record CreateGlobalSetRequest(
        UUID parentFolderUuid, String displayName, String contentCdl, String rulesCdl, String comment) {}
