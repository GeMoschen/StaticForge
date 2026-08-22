package com.acme.staticforge.asset.page;

import java.util.UUID;

/** Query filter for the page list endpoint (spec §20.2). */
public record PageQuery(UUID folderUuid, UUID templateUuid, String q) {}
