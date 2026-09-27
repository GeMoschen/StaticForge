package com.acme.staticforge.generate.quality;

import java.util.Collection;
import java.util.Set;

/**
 * The paths a build serves a redirect at (M30.5.1, {@link SiteIndex#redirectSources()}), for one set of its outputs: the
 * redirects a build emits depend on what it publishes (a source path that is a live output is shadowed, a target that
 * isn't one dangles), so the check stage asks once before and once after the hold-back.
 */
@FunctionalInterface
public interface RedirectSources {

    /** No redirect is served (a draft check, a target without redirect output). */
    RedirectSources NONE = outputs -> Set.of();

    /** The source paths of the redirects emitted by a build with {@code outputs}. */
    Set<String> of(Collection<IndexedOutput> outputs);
}
