package com.acme.staticforge.asset;

/** The newest revision an asset changed in within a revision range (M22.1.1), projected for build planning. */
public record AssetChange(long assetId, long revision) {}
