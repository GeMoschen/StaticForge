package com.acme.staticforge.generate;

/** Output destination backend for a {@link GenerationTarget} (spec §18.4). */
public enum TargetType {
    FILESYSTEM,
    ZIP,
    S3
}
