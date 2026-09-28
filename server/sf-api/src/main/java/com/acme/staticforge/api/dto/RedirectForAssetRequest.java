package com.acme.staticforge.api.dto;

import java.util.UUID;

/**
 * "Redirect old URL to…" (M30.4.1): one manual redirect per current page output of {@code assetUuid} in the default
 * target's current build, to page 1 of {@code toAssetUuid} or to {@code toPath} — exactly one of the two.
 */
public record RedirectForAssetRequest(UUID assetUuid, UUID toAssetUuid, String toPath) {}
