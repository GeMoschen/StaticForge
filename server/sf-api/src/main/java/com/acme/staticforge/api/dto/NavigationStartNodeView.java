package com.acme.staticforge.api.dto;

import java.util.UUID;

/** A navigation folder's {@code startNode} ({@code PAGE_REFERENCE} or {@code FOLDER}), or absent for a grouping-only folder. */
public record NavigationStartNodeView(String kind, UUID assetUuid) {}
