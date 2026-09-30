package com.acme.staticforge.asset.page;

import java.util.UUID;

/**
 * Query filter for the page list endpoint (spec §20.2). {@code revision} lists the pages as they were at that revision
 * (time travel: later deletions included, later creations left out); {@code null} lists the current ones.
 */
public record PageQuery(UUID folderUuid, UUID templateUuid, String q, Long revision) {

    public PageQuery(UUID folderUuid, UUID templateUuid, String q) {
        this(folderUuid, templateUuid, q, null);
    }
}
