package com.acme.staticforge.template.octl;

import com.acme.staticforge.template.content.ContentDefinition;
import java.util.UUID;

/**
 * An ancestor page template as a {@link ParentTemplateLoader} returns it (M20).
 *
 * @param uuid the template's asset UUID (cycle detection keys on it, never on the uid)
 * @param uid the template's uid, for diagnostics
 * @param channelSource the OCTL source of the requested channel, {@code null} when the template has none
 * @param ownDefinition the template's own compiled CDL definition (not its effective one)
 */
public record ParentSource(UUID uuid, String uid, String channelSource, ContentDefinition ownDefinition) {

    public ParentSource {
        ownDefinition = ownDefinition == null ? new ContentDefinition(null, null) : ownDefinition;
    }
}
