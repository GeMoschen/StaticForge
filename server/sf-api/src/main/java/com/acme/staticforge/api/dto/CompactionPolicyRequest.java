package com.acme.staticforge.api.dto;

/**
 * Body of {@code PUT /projects/{key}/compaction} (M29.4.1): switch revision compaction on or off and set how old
 * history must be. {@code olderThanDays} {@code null} keeps the current value (90 for a project that never set one).
 */
public record CompactionPolicyRequest(boolean enabled, Integer olderThanDays) {}
