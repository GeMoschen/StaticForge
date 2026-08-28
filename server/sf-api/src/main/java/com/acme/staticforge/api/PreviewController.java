package com.acme.staticforge.api;

import com.acme.staticforge.api.dto.PreviewSectionRequest;
import com.acme.staticforge.api.dto.PreviewShareLink;
import com.acme.staticforge.preview.PageRenderService;
import com.acme.staticforge.preview.PreviewTokenService;
import com.acme.staticforge.project.ProjectService;
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
 */
@RestController
@RequestMapping("/api/v1/projects/{projectKey}/preview")
public class PreviewController {

    private final ProjectService projectService;
    private final PageRenderService pageRenderService;
    private final PreviewTokenService previewTokenService;

    private static final SecureRandom NONCE = new SecureRandom();

    public PreviewController(
            ProjectService projectService, PageRenderService pageRenderService, PreviewTokenService previewTokenService) {
        this.projectService = projectService;
        this.pageRenderService = pageRenderService;
        this.previewTokenService = previewTokenService;
    }

    /**
     * Page preview by identity (spec §19.1): renders the page's current stored revision,
     * or {@code ?revision=R} for a past one. Content/bodies/meta are always resolved from
     * the database via {@code uuid} — the client never sends rendered data, only which
     * page (and optionally which revision) to render.
     */
    @GetMapping("/pages/{uuid}")
    @PreAuthorize("@projectAuth.has(#projectKey, " + ProjectRoleExpr.VIEWER + ")")
    public ResponseEntity<String> previewPage(
            @PathVariable String projectKey,
            @PathVariable UUID uuid,
            @RequestParam(required = false) Long revision,
            @RequestParam(defaultValue = "html") String channel,
            @RequestParam(defaultValue = "true") boolean rewriteLinks,
            HttpServletRequest request) {
        String output = pageRenderService.renderPage(
                projectId(projectKey), uuid, revision, channel, rewriteLinks, apiBase(request));
        return respond(output, channel);
    }

    /** Creates a signed, expiring share link for a saved page (spec §19.3). */
    @GetMapping("/pages/{uuid}/share")
    @PreAuthorize("@projectAuth.has(#projectKey, " + ProjectRoleExpr.VIEWER + ")")
    public PreviewShareLink share(
            @PathVariable String projectKey,
            @PathVariable UUID uuid,
            @RequestParam(required = false) Long revision,
            @RequestParam(defaultValue = "html") String channel) {
        String token = previewTokenService.issueShareToken(uuid, revision, channel, projectKey);
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
            HttpServletRequest request) {
        PreviewTokenService.ShareTarget target = previewTokenService.verifyShareToken(token);
        if (target.projectKey() != null && !target.projectKey().equals(projectKey)) {
            return respond("", channel);
        }
        String resolvedChannel = target.channel() != null ? target.channel() : channel;
        String output = pageRenderService.renderPage(
                projectId(projectKey), target.pageUuid(), target.revision(), resolvedChannel, true, apiBase(request));
        return respond(output, resolvedChannel);
    }

    /** Section template preview against sample content (spec §19.1). */
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
}
