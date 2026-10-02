package com.acme.staticforge.revision;

/** Computes the structural diff of a revision against the previous one (spec §7.6). */
public interface DiffService {

    RevisionDiff diff(long projectId, long revisionId);

    /**
     * Diff of one asset's content as of revision {@code from} against its content as of revision {@code to} ({@code null}
     * = the project's newest revision, i.e. the asset's current state). Compacted history is flagged like
     * {@link #diff}. {@code 404} for an unknown asset or revision.
     */
    AssetDiff diffAsset(long projectId, java.util.UUID assetUuid, long from, Long to);
}
