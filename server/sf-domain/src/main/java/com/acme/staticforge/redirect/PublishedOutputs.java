package com.acme.staticforge.redirect;

import java.util.Optional;

/**
 * What the project's default generation target serves now (M30.4.1): the outputs of the build its {@code current}
 * reference points at, read from that build's manifest. The registry view computes each redirect's state against it,
 * and {@code for-asset} takes an asset's current output paths from it. Implemented by the build module, which owns
 * targets and manifests.
 */
public interface PublishedOutputs {

    /** The build a target serves: its run and its outputs. */
    record PublishedBuild(long runId, RedirectOutputs outputs) {}

    /**
     * The current build of the project's default target (or its only target); empty when the project has no target,
     * nothing was published there, or the build's manifest can't be read.
     */
    Optional<PublishedBuild> current(long projectId);
}
