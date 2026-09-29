package com.acme.staticforge.generate.plan;

import java.util.Set;
import java.util.UUID;
import com.acme.staticforge.generate.target.BuildManifest;

/**
 * What an incremental plan builds on (M22.4.1): the revision changes are counted from, and the base build whose
 * outputs the run carries forward.
 *
 * @param manifest the base build's manifest; {@code null} only when planning without a base build (tests), in which
 *     case no output is checked against it
 * @param urlChanged the targets whose registered URL an override, reset or import changed since the base build started
 *     and that the manifest can't show (M32.5): folders (a folder link is no file), and every pages folder after a
 *     wide reset. Pages and media are compared with the manifest instead.
 */
public record Baseline(long revision, BuildManifest manifest, Set<UUID> urlChanged) {

    public Baseline {
        urlChanged = urlChanged == null ? Set.of() : Set.copyOf(urlChanged);
    }

    /** A baseline without URL registry changes. */
    public Baseline(long revision, BuildManifest manifest) {
        this(revision, manifest, Set.of());
    }
}
