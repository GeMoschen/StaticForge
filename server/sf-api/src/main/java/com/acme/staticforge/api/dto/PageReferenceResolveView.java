package com.acme.staticforge.api.dto;

import java.util.UUID;

/**
 * Resolved target of a {@code PageReference}, for the nav-store UI's live preview
 * (§ M8.1.5). Both fields are {@code null} when the reference cannot currently be
 * resolved (a dangling/deleted target) — matching {@code NavigationService.resolve}'s
 * own never-throws contract.
 */
public record PageReferenceResolveView(UUID pageUuid, String path) {}
