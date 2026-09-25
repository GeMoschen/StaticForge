package com.acme.staticforge.api.dto;

import java.util.List;
import java.util.UUID;

/**
 * A release, unpublish or discard request (M27.1.3). {@code items} are what the user selected; a release also takes
 * the dependencies the plan proposed and the user kept ticked, in {@code includeDependencies} — both lists are
 * released together, in one revision. {@code locale} omitted means every locale key of the asset.
 */
public record ReleaseRequest(List<Item> items, List<Item> includeDependencies, String comment) {

    /** One (asset, locale) of the request. */
    public record Item(UUID assetUuid, String locale) {}
}
