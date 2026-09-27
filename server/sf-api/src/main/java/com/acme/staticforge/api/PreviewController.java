package com.acme.staticforge.api;

import com.acme.staticforge.api.dto.PreviewSectionRequest;
import com.acme.staticforge.api.dto.PreviewShareLink;
import com.acme.staticforge.common.ProblemFactory;
import com.acme.staticforge.common.SfException;
import com.acme.staticforge.preview.PagePreview;
import com.acme.staticforge.preview.PageRenderService;
import com.acme.staticforge.preview.PreviewTokenService;
import com.acme.staticforge.project.Project;
import com.acme.staticforge.project.ProjectService;
import com.acme.staticforge.release.ContentView;
import com.acme.staticforge.release.ContentViews;
import com.acme.staticforge.release.LocaleRelease;
import com.acme.staticforge.release.ReleaseLocales;
import com.acme.staticforge.release.ReleaseStatusService;
import java.util.Map;
import jakarta.servlet.http.HttpServletRequest;
import java.security.SecureRandom;
import java.util.Base64;
import java.util.UUID;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * Preview endpoints (spec §19). Renders pages/sections through the shared M2 render engine
 * and serves the result sandboxed: {@code Content-Security-Policy: sandbox allow-scripts
 * allow-same-origin} with a per-request nonce, {@code X-Frame-Options: SAMEORIGIN} and
 * {@code X-Content-Type-Options: nosniff}. Non-HTML channels (for example {@code markdown})
 * are served as {@code text/plain}.
 *
 * <p>Page previews take an optional {@code page} (M21.3.1): the page number of a paginated page, clamped to its page
 * count. It is a plain query parameter, not part of a share token, so a share link opens page 1 and the page links
 * inside it carry their own {@code page}. {@value #TOTAL_PAGES_HEADER} and {@value #PAGE_HEADER} tell the editor how
 * many pages there are and which one was rendered.
 */
@RestController
@RequestMapping("/api/v1/projects/{projectKey}/preview")
public class PreviewController {

    private final ProjectService projectService;
    private final PageRenderService pageRenderService;
    private final PreviewTokenService previewTokenService;
    private final ContentViews contentViews;
    private final ReleaseStatusService releaseStatus;

    private static final SecureRandom NONCE = new SecureRandom();

    /** Which view a preview rendered: {@code draft} or {@code published} (M27.2.3). */
    static final String VIEW_HEADER = "X-SF-View";

    /** The draft view's page release status in the rendered language (M27.2.3), e.g. {@code CHANGED}. */
    static final String RELEASE_STATUS_HEADER = "X-SF-Release-Status";

    /** The page count of the previewed page ({@code 1} when not paginated). */
    static final String TOTAL_PAGES_HEADER = "X-SF-Total-Pages";

    /** The page number rendered, after clamping. */
    static final String PAGE_HEADER = "X-SF-Page";

    private final CompactedReads compactedReads;

    public PreviewController(
            ProjectService projectService,
            PageRenderService pageRenderService,
            PreviewTokenService previewTokenService,
            ContentViews contentViews,
            ReleaseStatusService releaseStatus,
            CompactedReads compactedReads) {
        this.compactedReads = compactedReads;
        this.projectService = projectService;
        this.pageRenderService = pageRenderService;
        this.previewTokenService = previewTokenService;
        this.contentViews = contentViews;
        this.releaseStatus = releaseStatus;
    }

    /**
     * Page preview by identity (spec §19.1): renders the page's current stored revision,
     * or {@code ?revision=R} for a past one. Content/bodies/meta are always resolved from
     * the database via {@code uuid} — the client never sends rendered data, only which
     * page (and optionally which revision) to render.
     *
     * <p>{@code ?view=draft} (default) renders the page's draft and the drafts of everything it reads;
     * {@code ?view=published} the release state the next build renders (M27.2.3) — {@code 404 SF-DOM-0155} for a page
     * not released in the language. {@code X-SF-View} names the view, and a draft preview carries the page's release
     * status for the language in {@code X-SF-Release-Status}.
     */
    @GetMapping("/pages/{uuid}")
    @PreAuthorize("@projectAuth.has(#projectKey, " + ProjectRoleExpr.VIEWER + ")")
    public ResponseEntity<String> previewPage(
            @PathVariable String projectKey,
            @PathVariable UUID uuid,
            @RequestParam(required = false) Long revision,
            @RequestParam(defaultValue = "html") String channel,
            @RequestParam(defaultValue = "true") boolean rewriteLinks,
            @RequestParam(required = false) Integer page,
            @RequestParam(required = false) String locale,
            @RequestParam(defaultValue = "draft") String view,
            HttpServletRequest request) {
        long projectId = projectId(projectKey);
        ContentView.Kind kind = viewOf(view);
        PagePreview preview = pageRenderService.renderPage(
                projectId, uuid, revision, channel, rewriteLinks, apiBase(request), page, locale, kind);
        ResponseEntity<String> response = respond(preview, channel);
        HttpHeaders headers = new HttpHeaders();
        headers.putAll(response.getHeaders());
        headers.set(VIEW_HEADER, kind.wireName());
        if (kind == ContentView.Kind.DRAFT) {
            String status = releaseStatusOf(projectId, uuid, locale);
            if (status != null) {
                headers.set(RELEASE_STATUS_HEADER, status);
            }
            // M29.4.3: the page itself shows compacted history at the revision (only the page is checked, not every
            // asset it renders; a published preview renders released versions, which compaction never touches).
            if (compactedReads.compacted(projectId, uuid, revision)) {
                headers.set(CompactedReads.HEADER, "true");
            }
        }
        return ResponseEntity.status(response.getStatusCode()).headers(headers).body(response.getBody());
    }

    /** The page's release status in {@code locale}'s key; {@code null} for an asset without release state. */
    private String releaseStatusOf(long projectId, UUID uuid, String locale) {
        Map<String, LocaleRelease> statuses = releaseStatus.ofAsset(projectId, uuid);
        LocaleRelease release = statuses.get(contentViews.localeKey(projectId, locale));
        if (release == null) {
            release = statuses.get(ReleaseLocales.ALL);
        }
        return release == null ? null : release.status().name();
    }

    private static ContentView.Kind viewOf(String view) {
        try {
            return ContentView.Kind.parse(view);
        } catch (IllegalArgumentException e) {
            throw new SfException(ProblemFactory.badRequest("view must be 'draft' or 'published'."));
        }
    }

    /** Creates a signed, expiring share link for a saved page (spec §19.3); none for an archived project (M26). */
    @GetMapping("/pages/{uuid}/share")
    @PreAuthorize("@projectAuth.has(#projectKey, " + ProjectRoleExpr.VIEWER + ")")
    public PreviewShareLink share(
            @PathVariable String projectKey,
            @PathVariable UUID uuid,
            @RequestParam(required = false) Long revision,
            @RequestParam(defaultValue = "html") String channel,
            @RequestParam(required = false) String locale,
            @RequestParam(defaultValue = "draft") String view) {
        projectService.requireWritable(projectKey);
        // The link keeps the view it was created in (M27.2.3): a published link keeps showing the released state.
        String token = previewTokenService.issueShareToken(uuid, revision, channel, projectKey, locale, viewOf(view));
        String url = "/api/v1/projects/" + projectKey + "/preview/share?t=" + token;
        return new PreviewShareLink(token, url);
    }

    /**
     * Public share route: renders one read-only page bound to a verified share token. Reachable
     * without a Bearer session — {@code SecurityConfig} permits {@code GET .../preview/share} at
     * the filter-chain level (method-level {@code @PreAuthorize} alone can't achieve this, since
     * filter-chain authorization runs first) — and is also what internal page links inside a
     * rendered preview are rewritten to (see {@code PageRenderService#urlResolver}), so clicking
     * through pages inside the preview iframe works without carrying the app's session into it.
     */
    @GetMapping("/share")
    @PreAuthorize("permitAll()")
    public ResponseEntity<String> share(
            @PathVariable String projectKey,
            @RequestParam("t") String token,
            @RequestParam(defaultValue = "html") String channel,
            @RequestParam(required = false) Integer page,
            HttpServletRequest request) {
        PreviewTokenService.ShareTarget target = previewTokenService.verifyShareToken(token);
        if (target.projectKey() != null && !target.projectKey().equals(projectKey)) {
            return respond("", channel);
        }
        String resolvedChannel = target.channel() != null ? target.channel() : channel;
        PagePreview preview = pageRenderService.renderPage(
                sharedProjectId(projectKey), target.pageUuid(), target.revision(), resolvedChannel, true, apiBase(request),
                page, target.locale(), target.view());
        return respond(preview, resolvedChannel);
    }

    /** Section template preview against sample content (spec §19.1). */
    @AllowedOnArchivedProject("Renders a preview, stores nothing.")
    @PostMapping("/section")
    @PreAuthorize("@projectAuth.has(#projectKey, " + ProjectRoleExpr.VIEWER + ")")
    public ResponseEntity<String> previewSection(
            @PathVariable String projectKey,
            @RequestParam(defaultValue = "html") String channel,
            @RequestBody PreviewSectionRequest body,
            HttpServletRequest request) {
        String output = pageRenderService.renderSection(projectId(projectKey), body.templateUuid(), body.sampleContent(), channel);
        return respond(output, channel);
    }

    // ------------------------------------------------------------------
    // Response assembly
    // ------------------------------------------------------------------

    private ResponseEntity<String> respond(PagePreview preview, String channel) {
        ResponseEntity<String> response = respond(preview.html(), channel);
        return ResponseEntity.status(response.getStatusCode())
                .headers(response.getHeaders())
                .header(TOTAL_PAGES_HEADER, String.valueOf(preview.totalPages()))
                .header(PAGE_HEADER, String.valueOf(preview.pageNumber()))
                .body(response.getBody());
    }

    private ResponseEntity<String> respond(String output, String channel) {
        String nonce = Base64.getUrlEncoder().withoutPadding().encodeToString(nonceBytes());
        MediaType contentType = isHtml(channel) ? MediaType.TEXT_HTML : MediaType.TEXT_PLAIN;
        String csp = "sandbox allow-scripts allow-same-origin; script-src 'nonce-" + nonce + "'";
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(contentType);
        headers.set("Content-Security-Policy", csp);
        // X-Frame-Options: SAMEORIGIN is applied uniformly by SecurityConfig — setting it again here
        // would land as a second, conflicting header (Spring MVC appends ResponseEntity headers rather
        // than replacing the security filter's default) and browsers refuse to frame a response with
        // conflicting values, even when one of them is otherwise permissive.
        headers.set("X-Content-Type-Options", "nosniff");
        return ResponseEntity.ok().headers(headers).body(output);
    }

    private static boolean isHtml(String channel) {
        return channel == null || channel.isBlank() || "html".equals(channel);
    }

    private static byte[] nonceBytes() {
        byte[] bytes = new byte[16];
        NONCE.nextBytes(bytes);
        return bytes;
    }

    private String apiBase(HttpServletRequest request) {
        String url = request.getRequestURL().toString();
        int idx = url.indexOf("/projects/");
        return idx < 0 ? "" : url.substring(0, idx);
    }

    private long projectId(String key) {
        return projectService.requireByKey(key).getId();
    }

    /** A share link of an archived project stops working (M26): {@code 404}, like a project that doesn't exist. */
    private long sharedProjectId(String key) {
        Project project = projectService.requireByKey(key);
        if (project.isArchived()) {
            throw new SfException(ProblemFactory.notFound("Project not found."));
        }
        return project.getId();
    }
}
