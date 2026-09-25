package com.acme.staticforge.scheduler;

import java.util.UUID;

/** An (asset, locale key) an action touches (M27.4.4); {@code locale} {@code ""} = every locale of the asset. */
public record ActionAsset(UUID assetUuid, String locale) {}
