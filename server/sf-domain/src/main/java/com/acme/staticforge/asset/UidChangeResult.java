package com.acme.staticforge.asset;

import java.util.List;

/**
 * Outcome of {@link AssetService#changeUid}: the old/new UID plus the informational list of
 * OCTL templates that still reference the old UID literally (spec §6.4). The warning never
 * blocks the change.
 */
public record UidChangeResult(String oldUid, String newUid, List<UidLiteralReference> affectedTemplates) {}
