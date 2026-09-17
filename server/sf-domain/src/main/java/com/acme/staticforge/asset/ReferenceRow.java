package com.acme.staticforge.asset;

/**
 * One {@link AssetReference} row with its kind and source path, projected for in-memory graph walks that explain the
 * edge they follow (M22.1.1).
 */
public record ReferenceRow(long fromAssetId, long toAssetId, ReferenceKind kind, String sourcePath) {}
