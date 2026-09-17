package com.acme.staticforge.generate.plan;

import com.acme.staticforge.generate.target.BuildManifest;

/**
 * What an incremental plan builds on (M22.4.1): the revision changes are counted from, and the base build whose
 * outputs the run carries forward.
 *
 * @param manifest the base build's manifest; {@code null} only when planning without a base build (tests), in which
 *     case no output is checked against it
 */
public record Baseline(long revision, BuildManifest manifest) {}
