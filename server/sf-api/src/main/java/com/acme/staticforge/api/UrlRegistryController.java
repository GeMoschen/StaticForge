package com.acme.staticforge.api;

import com.acme.staticforge.api.dto.UrlRegistryAssetView;
import com.acme.staticforge.api.dto.UrlRegistryEntryView;
import com.acme.staticforge.api.dto.UrlRegistryOverrideRequest;
import com.acme.staticforge.api.dto.UrlRegistryResetRequest;
import com.acme.staticforge.common.ProblemFactory;
import com.acme.staticforge.common.SfException;
import com.acme.staticforge.project.ProjectService;
import com.acme.staticforge.revision.RevisionContext;
import com.acme.staticforge.security.SecuritySupport;
import com.acme.staticforge.urlregistry.ResetScope;
import com.acme.staticforge.urlregistry.UrlArea;
import com.acme.staticforge.urlregistry.UrlRegistryEntry;
import com.acme.staticforge.urlregistry.UrlRegistryService;
import com.acme.staticforge.urlregistry.UrlTarget;
import com.acme.staticforge.urlregistry.UrlTargetType;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * URL registry endpoints (feature `02-url-registry`, `M8.2.4`; every target since M32.7). Thin controller: resolves
 * the project, authorizes, delegates to {@link UrlRegistryService}, and joins in the targets' display facts (one batch
 * per page of rows) so the UI gets display-ready rows.
 *
 * <p><b>Authorization.</b> Reads use {@code VIEWER}, matching every other project-settings read endpoint. Overrides use
 * {@code DEVELOPER}, matching {@code ChannelController.update}'s bar — output paths are the templates' business. Resets
 * use {@code PROJECT_ADMIN}: assigned URLs are gone for good, and a project or area reset wipes every channel's rows.
 *
 * <p><b>Errors.</b> {@code 409 SF-DOM-0200} when another target holds the URL, {@code 422 SF-DOM-0201} for a URL (or a
 * target) that can't be overridden, {@code 404} for an unknown row; archived projects refuse writes
 * ({@code 409 SF-DOM-0141}).
 */
@RestController
@RequestMapping("/api/v1/projects/{projectKey}/url-registry")
public class UrlRegistryController {

    private final ProjectService projectService;
    private final UrlRegistryService urlRegistryService;
    private final SecuritySupport securitySupport;

    public UrlRegistryController(
            ProjectService projectService, UrlRegistryService urlRegistryService, SecuritySupport securitySupport) {
        this.projectService = projectService;
        this.urlRegistryService = urlRegistryService;
        this.securitySupport = securitySupport;
    }

    /**
     * Lists rows, filtered by channel, area, target type, language ({@code ""} for rows without one;
     * {@code noLocale=true} says the same and survives clients that drop empty parameters, and wins over
     * {@code locale}), target and a
     * free-text {@code q} (in the URL, or in the target's display name or uid). Sorted by URL.
     */
    @GetMapping
    @PreAuthorize("@projectAuth.has(#projectKey, " + ProjectRoleExpr.VIEWER + ")")
    public Page<UrlRegistryEntryView> list(
            @PathVariable String projectKey,
            @RequestParam(required = false) String channelKey,
            @RequestParam(required = false) String area,
            @RequestParam(required = false) String targetType,
            @RequestParam(required = false) String locale,
            @RequestParam(defaultValue = "false") boolean noLocale,
            @RequestParam(required = false) UUID targetUuid,
            @RequestParam(required = false) String q,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "50") int size) {
        long projectId = projectId(projectKey);
        UrlRegistryService.Filter filter = new UrlRegistryService.Filter(
                blankToNull(channelKey), parseArea(area), parseType(targetType), noLocale ? "" : locale, targetUuid, q);
        Page<UrlRegistryEntry> rows = urlRegistryService.search(
                projectId, filter, PageRequest.of(Math.max(0, page), Math.min(Math.max(1, size), 500)));
        Map<UUID, UrlRegistryService.TargetInfo> infos = urlRegistryService.describe(
                projectId, rows.getContent().stream().map(UrlRegistryEntry::getTargetUuid).collect(Collectors.toSet()));
        return rows.map(e -> toView(e, infos.get(e.getTargetUuid())));
    }

    /** The URLs of one asset (both areas) and, for a pages folder, the index page it links instead (M32.7). */
    @GetMapping("/assets/{uuid}")
    @PreAuthorize("@projectAuth.has(#projectKey, " + ProjectRoleExpr.VIEWER + ")")
    public UrlRegistryAssetView forAsset(@PathVariable String projectKey, @PathVariable UUID uuid) {
        long projectId = projectId(projectKey);
        Map<UUID, UrlRegistryService.TargetInfo> infos = urlRegistryService.describe(projectId, Set.of(uuid));
        UrlRegistryService.TargetInfo info = infos.get(uuid);
        if (info == null) {
            throw new SfException(ProblemFactory.notFound("Asset not found."));
        }
        String type = switch (info.type()) {
            case "PAGE", "MEDIA", "FOLDER" -> info.type();
            default -> null;
        };
        List<UrlRegistryAssetView.IndexPageView> indexPages = new ArrayList<>();
        if ("FOLDER".equals(type)) {
            List<UrlRegistryService.IndexPage> pages = urlRegistryService.indexPages(projectId, uuid);
            Map<UUID, UrlRegistryService.TargetInfo> pageInfos = urlRegistryService.describe(
                    projectId, pages.stream().map(UrlRegistryService.IndexPage::pageUuid).collect(Collectors.toSet()));
            for (UrlRegistryService.IndexPage page : pages) {
                indexPages.add(new UrlRegistryAssetView.IndexPageView(
                        page.channelKey(), page.pageUuid(), label(pageInfos.get(page.pageUuid()))));
            }
        }
        List<UrlRegistryEntryView> entries = type == null
                ? List.of()
                : urlRegistryService.search(projectId,
                                new UrlRegistryService.Filter(null, null, null, null, uuid, null), Pageable.unpaged())
                        .map(e -> toView(e, info))
                        .getContent();
        return new UrlRegistryAssetView(uuid, type, indexPages, entries);
    }

    /** Overrides one existing row's URL. */
    @PatchMapping("/{id}")
    @PreAuthorize("@projectAuth.has(#projectKey, " + ProjectRoleExpr.DEVELOPER + ")")
    public UrlRegistryEntryView override(
            @PathVariable String projectKey, @PathVariable long id, @RequestBody UrlRegistryOverrideRequest body) {
        long projectId = projectId(projectKey);
        UrlRegistryEntry existing = urlRegistryService.require(projectId, id);
        UrlRegistryEntry updated = urlRegistryService.override(
                existing.target(),
                existing.getChannelKey(),
                existing.getArea(),
                existing.getLocaleKey(),
                body == null ? null : body.url(),
                ctx(projectId, "override URL registry entry"));
        return toView(updated, describe(projectId, updated.getTargetUuid()));
    }

    /** Sets a target's URL whether or not it has a row yet (M32.7). */
    @PutMapping
    @PreAuthorize("@projectAuth.has(#projectKey, " + ProjectRoleExpr.DEVELOPER + ")")
    public UrlRegistryEntryView assign(@PathVariable String projectKey, @RequestBody UrlRegistryOverrideRequest body) {
        long projectId = projectId(projectKey);
        if (body == null || body.targetUuid() == null) {
            throw invalid("targetUuid is required.", "targetUuid");
        }
        UrlTargetType type = parseType(body.targetType());
        if (type == null) {
            throw invalid("targetType is required (PAGE, MEDIA or FOLDER).", "targetType");
        }
        UrlArea area = parseArea(body.area());
        if (area == null) {
            throw invalid("area is required (GENERATED or PREVIEW).", "area");
        }
        int pageNumber = body.pageNumber() == null ? 1 : body.pageNumber();
        UrlTarget target;
        try {
            target = new UrlTarget(type, body.targetUuid(), body.variant(), pageNumber);
        } catch (IllegalArgumentException e) {
            throw invalid(e.getMessage() + ".", "targetType");
        }
        UrlRegistryEntry updated = urlRegistryService.override(
                target, body.channelKey(), area, body.locale(), body.url(), ctx(projectId, "override URL registry entry"));
        return toView(updated, describe(projectId, updated.getTargetUuid()));
    }

    @PostMapping("/reset")
    @PreAuthorize("@projectAuth.has(#projectKey, " + ProjectRoleExpr.ADMIN + ")")
    public ResponseEntity<Void> reset(@PathVariable String projectKey, @RequestBody(required = false) UrlRegistryResetRequest body) {
        long projectId = projectId(projectKey);
        ResetScope scope = toScope(projectId, body);
        urlRegistryService.reset(projectId, scope, ctx(projectId, "reset URL registry"));
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
        UUID targetUuid = body.targetUuid();

        if (targetUuid != null) {
            if (entryId != null || channelKey != null) {
                throw new SfException(ProblemFactory.badRequest("targetUuid can only be combined with area."));
            }
            return ResetScope.asset(targetUuid, area);
        }
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

    private static UrlArea parseArea(String area) {
        String normalized = blankToNull(area);
        if (normalized == null) {
            return null;
        }
        try {
            return UrlArea.valueOf(normalized.toUpperCase(Locale.ROOT));
        } catch (IllegalArgumentException e) {
            throw new SfException(ProblemFactory.badRequest("Invalid area: " + area + " (expected PREVIEW or GENERATED)."));
        }
    }

    private static UrlTargetType parseType(String type) {
        String normalized = blankToNull(type);
        if (normalized == null) {
            return null;
        }
        try {
            return UrlTargetType.valueOf(normalized.toUpperCase(Locale.ROOT));
        } catch (IllegalArgumentException e) {
            throw new SfException(ProblemFactory.badRequest(
                    "Invalid targetType: " + type + " (expected PAGE, MEDIA or FOLDER)."));
        }
    }

    private static SfException invalid(String detail, String field) {
        return com.acme.staticforge.urlregistry.UrlRegistryProblems.invalid(detail, field);
    }

    private static String blankToNull(String value) {
        return value == null || value.isBlank() ? null : value;
    }

    private long projectId(String key) {
        return projectService.requireByKey(key).getId();
    }

    private RevisionContext ctx(long projectId, String comment) {
        return RevisionContext.of(projectId, securitySupport.currentUserId(), comment);
    }

    private UrlRegistryService.TargetInfo describe(long projectId, UUID uuid) {
        return urlRegistryService.describe(projectId, Set.of(uuid)).get(uuid);
    }

    private static String label(UrlRegistryService.TargetInfo info) {
        if (info == null) {
            return null;
        }
        return info.displayName() != null && !info.displayName().isBlank() ? info.displayName() : info.uid();
    }

    private static UrlRegistryEntryView toView(UrlRegistryEntry e, UrlRegistryService.TargetInfo info) {
        return new UrlRegistryEntryView(
                e.getId(),
                e.getChannelKey(),
                e.getArea().name(),
                e.getLocaleKey(),
                e.getTargetType().name(),
                e.getTargetUuid(),
                label(info),
                info == null ? null : info.uid(),
                info == null ? null : info.folderPath(),
                info != null && info.deleted(),
                e.getVariantKey(),
                e.getPageNumber(),
                e.getUrl(),
                e.isOverridden(),
                e.getAssignedAt(),
                e.getAssignedRevision());
    }
}
