package com.acme.staticforge.api.dto;

/** Result of a folder move, reporting the number of rewritten asset versions. */
public record MoveResultDto(long touchedAssetCount, long revision) {}
