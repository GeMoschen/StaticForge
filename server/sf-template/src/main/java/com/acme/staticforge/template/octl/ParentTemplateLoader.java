package com.acme.staticforge.template.octl;

import java.util.Optional;
import java.util.UUID;

/**
 * Loads an ancestor page template for chain compilation (M20): its channel source and its own content
 * definition. Keeps {@code sf-template} free of repository access; the domain supplies a live or
 * revision-pinned implementation (template save, validate, preview) and generation one over its
 * snapshot, so every consumer compiles the same chain from the same kind of data.
 */
@FunctionalInterface
public interface ParentTemplateLoader {

    /**
     * The page template {@code pageTemplateUuid} as seen by this loader, or empty when it is not a live
     * page template (missing, soft-deleted, or another asset type).
     *
     * @param channelKey the channel being compiled; the result's {@code channelSource} is {@code null}
     *     when the template has no source for it
     */
    Optional<ParentSource> load(UUID pageTemplateUuid, String channelKey);
}
