package com.acme.staticforge.asset.folder;

/** Result of a folder move, reporting how many asset versions were rewritten (spec §10.2). */
public record MoveResult(long touchedAssetCount, long revision) {}
