package com.acme.staticforge.api;

import com.acme.staticforge.api.dto.RedirectForAssetRequest;
import com.acme.staticforge.api.dto.RedirectPageView;
import com.acme.staticforge.api.dto.RedirectRequest;
import com.acme.staticforge.api.dto.RedirectView;
import com.acme.staticforge.asset.AssetService;
import com.acme.staticforge.common.ProblemFactory;
import com.acme.staticforge.common.SfException;
import com.acme.staticforge.project.ProjectService;
import com.acme.staticforge.redirect.RedirectEntry;
import com.acme.staticforge.redirect.RedirectKind;
import com.acme.staticforge.redirect.RedirectService;
import com.acme.staticforge.security.SecuritySupport;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import org.springframework.data.domain.PageRequest;
import org.springframework.http.HttpHeaders;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * The redirect registry of a project (M30.4.1, epic decision 17). Members read ({@code VIEWER}); manual changes need
 * {@code DEVELOPER}, like URL registry overrides — output paths are the templates' business. {@code for-asset} (the
 * "Redirect old URL to…" of the unpublish and delete dialogs) is open to whoever may release and unpublish
 * ({@code RELEASE}, M28: editors under a policy that grants it, developers and admins always). Writes on an archived
 * project answer {@code 409 SF-DOM-0141}.
 *
 * <p>Errors: {@code 404 SF-DOM-0190} unknown id, {@code 409 SF-DOM-0191} the source path already redirects,
 * {@code 422 SF-DOM-0192} a loop, {@code 422 SF-DOM-0193} an invalid channel, locale, source or target,
 * {@code 422 SF-DOM-0194} (for-asset) no output to redirect; a stale {@code If-Match} is {@code 409 SF-API-0409}.
 */
@RestController
@RequestMapping("/api/v1/projects/{projectKey}/redirects")
public class RedirectController {

    static final int MAX_SIZE = 200;

    private final ProjectService projectService;
    private final RedirectService redirectService;
    private final AssetService assetService;
    private final SecuritySupport securitySupport;

    public RedirectController(
            ProjectService projectService,
            RedirectService redirectService,
            AssetService assetService,
            SecuritySupport securitySupport) {
        this.projectService = projectService;
        this.redirectService = redirectService;
        this.assetService = assetService;
        this.securitySupport = securitySupport;
    }

    /**
     * One page of redirects, sorted by channel, locale and source path, each with its state against the default
     * target's current build. Filters combine: {@code channel}, {@code locale} ({@code ""} is not a filter — every
     * locale), {@code kind} ({@code AUTO}/{@code MANUAL}), {@code q} (part of the source or fixed target path).
     */
    @GetMapping
    @PreAuthorize("@projectAuth.has(#projectKey, " + ProjectRoleExpr.VIEWER + ")")
    public RedirectPageView listRedirects(
            @PathVariable String projectKey,
            @RequestParam(required = false) String channel,
            @RequestParam(required = false) String locale,
            @RequestParam(required = false) String kind,
            @RequestParam(required = false) String q,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "50") int size) {
        if (page < 0 || size < 1 || size > MAX_SIZE) {
            throw new SfException(ProblemFactory.badRequest("page must be ≥ 0 and size between 1 and " + MAX_SIZE + "."));
        }
        long projectId = projectId(projectKey);
        RedirectService.Listing listing = redirectService.list(
                projectId, new RedirectService.Filter(channel, locale, kind(kind), q), PageRequest.of(page, size));
        Map<UUID, String> names = new HashMap<>();
        List<RedirectView> rows = listing.rows().getContent().stream().map(row -> view(projectId, row, names)).toList();
        return new RedirectPageView(
                rows, page, size, listing.rows().getTotalElements(), listing.rows().getTotalPages(), listing.basisRunId());
    }

    /** One redirect with its state; {@code ETag: "v{version}"}. */
    @GetMapping("/{id}")
    @PreAuthorize("@projectAuth.has(#projectKey, " + ProjectRoleExpr.VIEWER + ")")
    public ResponseEntity<RedirectView> redirect(@PathVariable String projectKey, @PathVariable long id) {
        return respond(projectId(projectKey), id);
    }

    /** Creates a manual redirect. */
    @PostMapping
    @PreAuthorize("@projectAuth.has(#projectKey, " + ProjectRoleExpr.DEVELOPER + ")")
    public ResponseEntity<RedirectView> createRedirect(@PathVariable String projectKey, @RequestBody RedirectRequest body) {
        long projectId = projectId(projectKey);
        RedirectEntry entry = redirectService.create(projectId, command(body), userId());
        return respond(projectId, entry.getId());
    }

    /**
     * Replaces a redirect; {@code If-Match: "v{version}"} is required ({@code 412} when missing). An {@code AUTO}
     * entry becomes {@code MANUAL}.
     */
    @PutMapping("/{id}")
    @PreAuthorize("@projectAuth.has(#projectKey, " + ProjectRoleExpr.DEVELOPER + ")")
    public ResponseEntity<RedirectView> updateRedirect(
            @PathVariable String projectKey,
            @PathVariable long id,
            @RequestHeader(value = HttpHeaders.IF_MATCH, required = false) String ifMatch,
            @RequestBody RedirectRequest body) {
        long projectId = projectId(projectKey);
        redirectService.update(projectId, id, ScheduleController.expectedVersion(ifMatch), command(body), userId());
        return respond(projectId, id);
    }

    /** Deletes a redirect ({@code AUTO} ones too); an {@code If-Match} header, when sent, must be current. */
    @DeleteMapping("/{id}")
    @PreAuthorize("@projectAuth.has(#projectKey, " + ProjectRoleExpr.DEVELOPER + ")")
    public ResponseEntity<Void> deleteRedirect(
            @PathVariable String projectKey,
            @PathVariable long id,
            @RequestHeader(value = HttpHeaders.IF_MATCH, required = false) String ifMatch) {
        Long expected = ifMatch == null || ifMatch.isBlank() ? null : ScheduleController.expectedVersion(ifMatch);
        redirectService.delete(projectId(projectKey), id, expected, userId());
        return ResponseEntity.noContent().build();
    }

    /**
     * One manual redirect per current page output of {@code assetUuid} (every channel, locale and page number of the
     * default target's current build) to page 1 of {@code toAssetUuid} or to {@code toPath}; existing redirects of
     * those paths are replaced. Returns the redirects it wrote.
     */
    @PostMapping("/for-asset")
    @PreAuthorize("@projectAuth.can(#projectKey, 'RELEASE')")
    public List<RedirectView> redirectForAsset(@PathVariable String projectKey, @RequestBody RedirectForAssetRequest body) {
        long projectId = projectId(projectKey);
        List<RedirectEntry> written = redirectService.createForAsset(
                projectId, body.assetUuid(), body.toAssetUuid(), body.toPath(), userId());
        Map<UUID, String> names = new HashMap<>();
        return redirectService.rows(projectId, written).stream().map(row -> view(projectId, row, names)).toList();
    }

    // ------------------------------------------------------------------

    private ResponseEntity<RedirectView> respond(long projectId, long id) {
        RedirectService.Row row = redirectService.get(projectId, id);
        return ResponseEntity.ok()
                .header(HttpHeaders.ETAG, "\"v" + row.entry().getVersion() + "\"")
                .body(view(projectId, row, new HashMap<>()));
    }

    private RedirectView view(long projectId, RedirectService.Row row, Map<UUID, String> names) {
        RedirectEntry e = row.entry();
        String toAssetName = e.getToAssetUuid() == null
                ? null
                : names.computeIfAbsent(e.getToAssetUuid(), uuid -> displayName(projectId, uuid));
        return new RedirectView(
                e.getId(),
                e.getChannelKey(),
                e.getLocaleKey(),
                e.getFromPath(),
                e.getToAssetUuid(),
                e.getToPageNumber(),
                toAssetName,
                e.getToPath(),
                e.getKind().name(),
                row.state() == null ? null : row.state().name(),
                row.target(),
                e.getCreatedAt(),
                e.getCreatedBy(),
                e.getSourceRunId(),
                e.getUpdatedAt(),
                e.getUpdatedBy(),
                e.getVersion());
    }

    /** The target page's current display name; {@code null} when it is gone (the redirect is dangling then). */
    private String displayName(long projectId, UUID uuid) {
        try {
            return assetService.requireCurrent(projectId, uuid).displayName();
        } catch (SfException e) {
            return null;
        }
    }

    private static RedirectService.Command command(RedirectRequest body) {
        return new RedirectService.Command(
                body.channel(), body.locale(), body.fromPath(), body.toAssetUuid(), body.toPageNumber(), body.toPath());
    }

    private static RedirectKind kind(String value) {
        if (value == null || value.isBlank()) {
            return null;
        }
        try {
            return RedirectKind.valueOf(value.trim().toUpperCase(Locale.ROOT));
        } catch (IllegalArgumentException e) {
            throw new SfException(ProblemFactory.badRequest("Unknown kind: " + value + " (expected AUTO or MANUAL).", "kind"));
        }
    }

    private long projectId(String key) {
        return projectService.requireByKey(key).getId();
    }

    private long userId() {
        return securitySupport.currentUserId();
    }
}
