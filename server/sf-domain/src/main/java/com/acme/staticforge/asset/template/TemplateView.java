package com.acme.staticforge.asset.template;

import com.acme.staticforge.asset.AssetType;
import com.acme.staticforge.template.content.EffectiveDefinition;
import com.fasterxml.jackson.databind.JsonNode;
import java.util.List;
import java.util.UUID;

/**
 * Projection of a section/page template's current state (spec §12, §13). Combines the
 * identity columns with the {@code payload} carrying the CDL source, the compiled
 * content definition and the per-channel OCTL templates. {@code folderUuid}/{@code folderPath}
 * surface the template's current folder (spec M13.1.3), mirroring {@code PageView}'s shape.
 *
 * @param effectiveDefinition a page template's own and inherited definition (M20), {@code null} for a section template
 * @param ancestors a page template's recorded ancestors, parent first (M20)
 * @param descendantWarnings warnings a page template save produced on its descendants (M20.2.2), empty otherwise
 */
public record TemplateView(
        UUID uuid,
        String uid,
        AssetType kind,
        String displayName,
        JsonNode payload,
        long validFromRevision,
        boolean deleted,
        UUID folderUuid,
        String folderPath,
        EffectiveDefinition effectiveDefinition,
        List<TemplateRef> ancestors,
        List<DescendantIssue> descendantWarnings) {

    public TemplateView {
        ancestors = ancestors == null ? List.of() : List.copyOf(ancestors);
        descendantWarnings = descendantWarnings == null ? List.of() : List.copyOf(descendantWarnings);
    }

    /** A template named by UUID and uid. */
    public record TemplateRef(UUID uuid, String uid) {}

    /** {@code payload.abstract}: pages can't use the template (M20; page templates only). */
    public boolean isAbstract() {
        return payload != null && payload.path("abstract").asBoolean(false);
    }
}
