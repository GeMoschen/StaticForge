package com.acme.staticforge.api.dto;

import com.acme.staticforge.asset.content.ContentIssue;
import java.util.List;
import java.util.UUID;

/**
 * The dry run of a release (M27.1.3): the resolved selection, the proposed dependencies with the reason each is
 * proposed ({@code REFERENCE}, {@code CONTAINER}, {@code SET_MEMBER}, {@code DESCENDANT}) and the asset that needs it,
 * the items too incomplete to release, and warnings. Dependencies with {@code includedByDefault = false} (a changed
 * folder's changed descendants) are offered unticked.
 */
public record ReleasePlanView(
        List<ReleaseTargetView> items,
        List<Dependency> dependencies,
        List<Incomplete> incomplete,
        List<String> warnings) {

    public record Dependency(ReleaseTargetView target, String reason, UUID via, boolean includedByDefault) {}

    public record Incomplete(UUID uuid, String locale, List<ContentIssue> issues) {}
}
