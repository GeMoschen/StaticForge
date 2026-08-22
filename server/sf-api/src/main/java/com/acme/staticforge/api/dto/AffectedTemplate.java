package com.acme.staticforge.api.dto;

import java.util.UUID;

/** A template whose OCTL {@code source} still references an old UID literally (spec §6.4). */
public record AffectedTemplate(
        UUID assetUuid,
        String assetUid,
        String assetType,
        String displayName,
        String channelKey) {}
