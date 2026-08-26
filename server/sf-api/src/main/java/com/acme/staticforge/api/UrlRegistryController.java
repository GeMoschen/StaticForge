package com.acme.staticforge.api;

import com.acme.staticforge.api.dto.UrlRegistryEntryView;
import com.acme.staticforge.api.dto.UrlRegistryOverrideRequest;
import com.acme.staticforge.api.dto.UrlRegistryResetRequest;
import com.acme.staticforge.asset.AssetService;
import com.acme.staticforge.asset.AssetVersionView;
import com.acme.staticforge.common.ProblemFactory;
import com.acme.staticforge.common.SfException;
import com.acme.staticforge.project.ProjectService;
import com.acme.staticforge.revision.RevisionContext;
import com.acme.staticforge.security.SecuritySupport;
import com.acme.staticforge.urlregistry.ResetScope;
import com.acme.staticforge.urlregistry.UrlArea;
import com.acme.staticforge.urlregistry.UrlRegistryEntry;
import com.acme.staticforge.urlregistry.UrlRegistryService;
import com.fasterxml.jackson.databind.JsonNode;
import java.util.List;
import java.util.UUID;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * URL registry endpoints (feature `02-url-registry`, `M8.2.4`). Thin controller: resolves the
 * project, authorizes, delegates to {@link UrlRegistryService}, and joins in a human-readable
 * {@code PageReference} label (via {@link AssetService}, mirroring how {@code
 * NavigationController} resolves a page's path from {@code AssetVersionView.folderPath}) so the
 * settings UI (`M8.2.5`) gets a display-ready row without an extra call per entry.
 *
 * <p><b>Authorization.</b> List (read) uses {@code VIEWER}, matching every other
 * project-settings read endpoint. {@code override} uses {@code DEVELOPER}, matching {@code
 * ChannelController.update}'s bar for editing existing project-settings configuration. {@code
 * reset} uses {@code PROJECT_ADMIN}: it is destructive (assigned URLs are gone, not
 * recoverable) and — at the {@code PROJECT}/{@code AREA} scopes — can wipe every channel's
 * cached URLs in one call, which matches {@code ChannelController.delete}'s precedent (the only
 * other destructive-at-project-scale mutation in this API), not the {@code DEVELOPER} bar used
 * for routine edits.
 *
 * <p><b>Free-text search (the {@code q} param).</b> {@link UrlRegistryRepository#search} (the
 * `M8.2.2` repository query) only filters on {@code channelKey}/{@code area} — it has no column
 * to text-search, since the human-readable label lives on the {@code PageReference} asset, not
 * on {@code UrlRegistryEntry}. Rather than add a cross-module JPA join from sf-domain's
 * repository into the asset tables (a layering violation this codebase avoids elsewhere), {@code
 * q} is applied in-memory here, after the same label join the response DTO needs anyway: an
 * unpaged, channel/area-filtered fetch is joined and label-enriched, filtered by {@code url}/
 * {@code pageReferenceLabel} containing {@code q} (case-insensitive), then paginated in memory.
 * Registries are project-scoped configuration data (one row per {@code PageReference} x channel
 * x area), not a large content table, so this is cheap in practice; the plain (no {@code q})
 * path stays a single paginated DB query with per-page label joins only.
 */
@RestController
@RequestMapping("/api/v1/projects/{projectKey}/url-registry")
public class UrlRegistryController {

    private final ProjectService projectService;
    private final UrlRegistryService urlRegistryService;
    private final AssetService assetService;
    private final SecuritySupport securitySupport;

    public UrlRegistryController(
            ProjectService projectService,
            UrlRegistryService urlRegistryService,
            AssetService assetService,
            SecuritySupport securitySupport) {
        this.projectService = projectService;
        this.urlRegistryService = urlRegistryService;
        this.assetService = assetService;
        this.securitySupport = securitySupport;
    }

    @GetMapping
    @PreAuthorize("@projectAuth.has(#projectKey, " + ProjectRoleExpr.VIEWER + ")")
    public Page<UrlRegistryEntryView> list(
            @PathVariable String projectKey,
            @RequestParam(required = false) String channelKey,
            @RequestParam(required = false) String area,
            @RequestParam(required = false) String q,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "50") int size) {
        long projectId = projectId(projectKey);
        UrlArea urlArea = parseArea(area);
        String normalizedChannelKey = blankToNull(channelKey);

        if (q != null && !q.isBlank()) {
            String needle = q.trim().toLowerCase();
            List<UrlRegistryEntryView> all = urlRegistryService
                    .search(projectId, normalizedChannelKey, urlArea, Pageable.unpaged())
                    .stream()
                    .map(this::toView)
                    .filter(v -> matches(v, needle))
                    .toList();
            int from = Math.min(page * size, all.size());
            int to = Math.min(from + size, all.size());
            return new PageImpl<>(all.subList(from, to), PageRequest.of(page, size), all.size());
        }

        return urlRegistryService.search(projectId, normalizedChannelKey, urlArea, PageRequest.of(page, size)).map(this::toView);
    }

    @PatchMapping("/{id}")
    @PreAuthorize("@projectAuth.has(#projectKey, " + ProjectRoleExpr.DEVELOPER + ")")
    public UrlRegistryEntryView override(
            @PathVariable String projectKey, @PathVariable long id, @RequestBody UrlRegistryOverrideRequest body) {
        long projectId = projectId(projectKey);
        UrlRegistryEntry existing = urlRegistryService.require(projectId, id);
        UrlRegistryEntry updated = urlRegistryService.override(
                existing.getPageReferenceUuid(),
                existing.getChannelKey(),
                existing.getArea(),
                body.url(),
                ctx(projectKey, "override URL registry entry"));
        return toView(updated);
    }

    @PostMapping("/reset")
    @PreAuthorize("@projectAuth.has(#projectKey, " + ProjectRoleExpr.ADMIN + ")")
    public ResponseEntity<Void> reset(@PathVariable String projectKey, @RequestBody(required = false) UrlRegistryResetRequest body) {
        long projectId = projectId(projectKey);
        ResetScope scope = toScope(projectId, body);
        urlRegistryService.reset(projectId, scope, ctx(projectKey, "reset URL registry"));
        return ResponseEntity.noContent().build();
    }

    // ------------------------------------------------------------------

    private ResetScope toScope(long projectId, UrlRegistryResetRequest body) {
        if (body == null) {
            return ResetScope.project();
        }
        Long entryId = body.entryId();
        String channelKey = blankToNull(body.channelKey());
        UrlArea area = parseArea(body.area());

        int provided = (entryId != null ? 1 : 0) + (channelKey != null ? 1 : 0) + (area != null ? 1 : 0);
        if (provided > 1) {
            throw new SfException(ProblemFactory.badRequest("Only one of entryId, channelKey, area may be provided."));
        }
        if (entryId != null) {
            // Scope the id to this project first so a caller cannot delete another project's
            // entry by guessing an id against this project's endpoint.
            urlRegistryService.require(projectId, entryId);
            return ResetScope.entry(entryId);
        }
        if (channelKey != null) {
            return ResetScope.channel(channelKey);
        }
        if (area != null) {
            return ResetScope.area(area);
        }
        return ResetScope.project();
    }

    private static boolean matches(UrlRegistryEntryView v, String needle) {
        return (v.url() != null && v.url().toLowerCase().contains(needle))
                || (v.pageReferenceLabel() != null && v.pageReferenceLabel().toLowerCase().contains(needle));
    }

    private static UrlArea parseArea(String area) {
        String normalized = blankToNull(area);
        if (normalized == null) {
            return null;
        }
        try {
            return UrlArea.valueOf(normalized.toUpperCase());
        } catch (IllegalArgumentException e) {
            throw new SfException(ProblemFactory.badRequest("Invalid area: " + area + " (expected PREVIEW or GENERATED)."));
        }
    }

    private static String blankToNull(String value) {
        return value == null || value.isBlank() ? null : value;
    }

    private long projectId(String key) {
        return projectService.requireByKey(key).getId();
    }

    private RevisionContext ctx(String key, String comment) {
        return RevisionContext.of(projectId(key), securitySupport.currentUserId(), comment);
    }

    private UrlRegistryEntryView toView(UrlRegistryEntry e) {
        return new UrlRegistryEntryView(
                e.getId(),
                e.getChannelKey(),
                e.getPageReferenceUuid(),
                pageReferenceLabel(e.getPageReferenceUuid()),
                e.getArea().name(),
                e.getUrl(),
                e.isOverridden(),
                e.getAssignedAt(),
                e.getAssignedRevision());
    }

    /**
     * Human-readable label for a {@code PageReference}: its {@code label} payload override if
     * set, else its {@code displayName} — mirroring {@code NavigationController.toReferenceView}'s
     * label extraction. Returns {@code null} rather than failing the whole list when the
     * reference is a stale/dangling uuid (e.g. deleted out from under a registry entry that
     * hasn't been reset yet).
     */
    private String pageReferenceLabel(UUID pageReferenceUuid) {
        try {
            AssetVersionView v = assetService.requireCurrent(pageReferenceUuid);
            JsonNode labelNode = v.payload() == null ? null : v.payload().path("label");
            if (labelNode != null && !labelNode.isMissingNode() && !labelNode.isNull() && !labelNode.asText().isBlank()) {
                return labelNode.asText();
            }
            return v.displayName();
        } catch (SfException e) {
            return null;
        }
    }
}
