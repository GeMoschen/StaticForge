package com.acme.staticforge.api.dto;

import com.acme.staticforge.asset.content.ContentIssue;
import java.util.List;
import java.util.UUID;

/**
 * The dry run of a release (M27.1.3): the resolved selection, the proposed dependencies with the reason each is
 * proposed ({@code REFERENCE}, {@code CONTAINER}, {@code SET_MEMBER}, {@code DESCENDANT}) and the asset that needs it,
 * the items too incomplete to release ({@code incomplete}: rule and built-in errors), and warnings. M33.6 adds the rule
 * warnings a release must accept ({@code warningFindings}, {@code acceptWarnings}), the infos ({@code infoFindings})
 * and the values the release fills would write ({@code fills}). Dependencies with {@code includedByDefault = false} (a changed
 * folder's changed descendants) are offered unticked.
 */
public record ReleasePlanView(
        List<ReleaseTargetView> items,
        List<Dependency> dependencies,
        List<Incomplete> incomplete,
        List<String> warnings,
        List<Incomplete> warningFindings,
        List<Incomplete> infoFindings,
        List<Fill> fills) {

    /** A value a {@code release} fill would write (M33.6); {@code locale} is set for a language-dependent field. */
    public record Fill(UUID uuid, String locale, String path, com.fasterxml.jackson.databind.JsonNode value) {}

    public record Dependency(ReleaseTargetView target, String reason, UUID via, boolean includedByDefault) {}

    public record Incomplete(UUID uuid, String locale, List<ContentIssue> issues) {}
}
