package com.acme.staticforge.api.dto;

import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.databind.JsonNode;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * Full section/page template representation, surfaced from the asset version payload.
 * {@code folderUuid}/{@code folderPath} mirror {@code PageView}'s shape (spec M13.1.3).
 *
 * <p>Page templates (M20): {@code abstract}; the derived {@code parentTemplateRef}; {@code ancestors} (parent
 * first); {@code effectiveDefinition}, the own and inherited editors and bodies a page form uses, with
 * {@code inheritedFrom} naming the ancestor of each inherited one; {@code descendantWarnings} from the save that
 * returned this representation. {@code compiledDefinition} stays the template's own definition.
 */
public record TemplateDetail(
        UUID uuid,
        String uid,
        String assetType,
        String displayName,
        long revision,
        String contentDefinition,
        JsonNode compiledDefinition,
        JsonNode channelTemplates,
        String category,
        boolean deprecated,
        JsonNode bodies,
        JsonNode outputPath,
        UUID folderUuid,
        String folderPath,
        @JsonProperty("abstract") boolean abstractTemplate,
        UUID parentTemplateRef,
        List<TemplateRefDto> ancestors,
        JsonNode effectiveDefinition,
        InheritedFrom inheritedFrom,
        List<DescendantIssueDto> descendantWarnings) {

    /** A template named by UUID and uid. */
    public record TemplateRefDto(UUID uuid, String uid) {}

    /** Inherited editor and body names → the uid of the ancestor declaring each. */
    public record InheritedFrom(Map<String, String> editors, Map<String, String> bodies) {}

    /** Diagnostics of one descendant template, for one channel or ({@code channel == null}) its definition. */
    public record DescendantIssueDto(
            UUID uuid, String uid, String channel, List<com.acme.staticforge.template.diagnostic.Diagnostic> diagnostics) {}
}
