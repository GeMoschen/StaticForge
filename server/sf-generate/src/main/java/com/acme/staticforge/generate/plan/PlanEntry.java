package com.acme.staticforge.generate.plan;

import java.util.UUID;

/**
 * A single unit of rendering work (spec §18.3): one page materialized for one channel to a
 * concrete output path. The {@code outputPath} is relative, forward-slash, with no leading
 * slash and no {@code ..} segments (see {@code OutputFile.normalize}).
 */
public record PlanEntry(UUID pageUuid, String channel, String outputPath) {}
