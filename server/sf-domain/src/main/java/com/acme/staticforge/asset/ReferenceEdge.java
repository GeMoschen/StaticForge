package com.acme.staticforge.asset;

/** The endpoints of one {@link AssetReference} row, projected for in-memory graph walks. */
public record ReferenceEdge(long fromAssetId, long toAssetId) {}
