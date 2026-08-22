package com.acme.staticforge.asset;

import java.util.UUID;

/** One inbound reference to an asset, resolved back to the referring asset (spec §5.4). */
public record UsageView(UUID fromUuid, String fromUid, AssetType fromType, ReferenceKind kind, String sourcePath) {}
