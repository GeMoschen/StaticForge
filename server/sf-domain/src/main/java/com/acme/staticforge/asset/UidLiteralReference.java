package com.acme.staticforge.asset;

import java.util.UUID;

/**
 * A single OCTL template whose {@code source} still carries an old UID literally after a
 * UID change (spec §6.4). Compiled templates already resolve to UUIDs; this is about the
 * {@code source} text the developer still needs to fix by hand.
 */
public record UidLiteralReference(
        UUID assetUuid,
        String assetUid,
        AssetType assetType,
        String displayName,
        String channelKey) {}
