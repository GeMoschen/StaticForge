package com.acme.staticforge.revision.compaction;

import java.util.Set;

/**
 * The revisions of a project's builds that are still on disk (M29.4.2, epic decision 13 (b)): for each retained build
 * of each target, its manifest's revision and consistent revision. Revision compaction keeps every version valid at
 * one of them, so a rebuild at that revision and an incremental build on top of that baseline stay exact.
 *
 * <p>Implemented where the target writers live (sf-generate). Answering more revisions than needed is safe (it only
 * keeps more versions); answering fewer is not, so an implementation that can't read a target must fail rather than
 * leave its builds out.
 */
public interface RetainedBuildRevisions {

    /** The manifest revisions and consistent revisions of every build of {@code projectId} still on disk. */
    Set<Long> revisionsFor(long projectId);
}
