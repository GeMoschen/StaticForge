package com.acme.staticforge.asset.globals;

import com.acme.staticforge.template.cdl.CdlSources;
import java.util.UUID;

/**
 * Command to create a global property set (M17.1.2). {@code parentFolderUuid} may be {@code null},
 * in which case the set lands directly in the project's fixed {@code globals_root} folder, which
 * is provisioned lazily if the project predates M17.
 */
public record CreateGlobalSetCommand(
        long projectId, UUID parentFolderUuid, String displayName, CdlSources cdl) {}
