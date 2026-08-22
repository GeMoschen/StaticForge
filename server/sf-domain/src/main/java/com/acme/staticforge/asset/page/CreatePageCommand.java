package com.acme.staticforge.asset.page;

import java.util.UUID;

/** Command to create a page (spec §20.2). */
public record CreatePageCommand(String displayName, UUID folderUuid, UUID templateUuid) {}
