package com.acme.staticforge.revision;

import java.util.List;

/** Structural diff of all touched assets in a revision against the previous one. */
public record RevisionDiff(long projectId, long revisionId, List<AssetDiff> assets) {}
