package com.acme.staticforge.asset;

/** Query filter for the generic asset list/search (spec §20.1, §20.2). */
public record AssetQuery(Long projectId, AssetType type, String folder, String q) {}
