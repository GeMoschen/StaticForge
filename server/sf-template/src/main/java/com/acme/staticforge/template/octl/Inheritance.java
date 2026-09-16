package com.acme.staticforge.template.octl;

import com.acme.staticforge.template.content.EffectiveDefinition;
import java.util.List;
import java.util.UUID;

/**
 * How a page template's {@code $CMS_EXTENDS} chain is compiled (M20).
 *
 * @param templateUuid the UUID of the template being compiled, or {@code null} when it has none yet (an
 *     unsaved template); lets a template that extends itself be reported without loading it twice
 * @param templateUid its uid for diagnostics, or {@code null}
 * @param loader loads ancestors; {@code null} means ancestors can't be loaded in this context, and a
 *     template that extends compiles with a single {@code SF-TPL-0161}
 * @param memo compiled ancestors shared by several compiles against the same loader and resolver (one
 *     build, one request), or {@code null}
 * @param inheritedDefinitions the own definitions of the template's recorded ancestors, root first, or
 *     {@code null}: a page template whose other channel extends a parent inherits that parent's CDL in every
 *     channel, so a channel source that doesn't extend is checked against them too
 */
public record Inheritance(
        UUID templateUuid,
        String templateUid,
        ParentTemplateLoader loader,
        ChainCompileMemo memo,
        List<EffectiveDefinition.Layer> inheritedDefinitions) {

    public Inheritance {
        inheritedDefinitions = inheritedDefinitions == null ? null : List.copyOf(inheritedDefinitions);
    }

    public Inheritance(UUID templateUuid, String templateUid, ParentTemplateLoader loader, ChainCompileMemo memo) {
        this(templateUuid, templateUid, loader, memo, null);
    }

    /** Ancestors from {@code loader}, no identity for the compiled template, no shared memo. */
    public static Inheritance of(ParentTemplateLoader loader) {
        return new Inheritance(null, null, loader, null, null);
    }
}
