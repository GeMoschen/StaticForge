package com.acme.staticforge.revision;

/** Computes the structural diff of a revision against the previous one (spec §7.6). */
public interface DiffService {

    RevisionDiff diff(long projectId, long revisionId);
}
