package com.acme.staticforge.api.dto;

import java.util.UUID;

/**
 * Reset-scope body for {@code POST .../url-registry/reset} (`M8.2.4`). At most one of {@code entryId},
 * {@code targetUuid} (every row of one asset, M32.7), {@code channelKey} or {@code area} may be set — except that
 * {@code area} may narrow a {@code targetUuid} reset; an empty body ({@code {}}, or none) resets the whole project.
 */
public record UrlRegistryResetRequest(Long entryId, String channelKey, String area, UUID targetUuid) {

    public UrlRegistryResetRequest(Long entryId, String channelKey, String area) {
        this(entryId, channelKey, area, null);
    }
}
