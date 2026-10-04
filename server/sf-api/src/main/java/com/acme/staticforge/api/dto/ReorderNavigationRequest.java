package com.acme.staticforge.api.dto;

import java.util.List;
import java.util.UUID;

/**
 * Body of {@code PUT .../navigation/folders/{uuid}/order} (M35.22): the folder's direct children in the order the menu
 * shows them. May name only some of the children (the rest follow alphabetically); empty clears the stored order.
 */
public record ReorderNavigationRequest(List<UUID> childUuids) {}
