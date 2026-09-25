package com.acme.staticforge.api;

import com.acme.staticforge.api.dto.FocalPointView;
import com.acme.staticforge.api.dto.MediaBulkItemResult;
import com.acme.staticforge.api.dto.MediaImageView;
import com.acme.staticforge.api.dto.MediaLocaleFileView;
import com.acme.staticforge.api.dto.MediaLocalizedRequest;
import com.acme.staticforge.api.dto.MediaMetadataRequest;
import com.acme.staticforge.api.dto.MediaProcessRequest;
import com.acme.staticforge.api.dto.MediaSaveResponse;
import com.acme.staticforge.api.dto.MediaSummaryView;
import com.acme.staticforge.api.dto.MediaVariantView;
import com.acme.staticforge.api.dto.MediaTextRequest;
import com.acme.staticforge.api.dto.MediaTextView;
import com.acme.staticforge.api.dto.MediaView;
import com.acme.staticforge.api.dto.OctlValidateResponse;
import com.acme.staticforge.api.dto.ScheduledRefView;
import com.acme.staticforge.asset.AssetVersionView;
import com.acme.staticforge.asset.media.FocalPoint;
import com.acme.staticforge.asset.media.MediaBinary;
import com.acme.staticforge.asset.media.MediaFiles;
import com.acme.staticforge.asset.media.MediaService;
import com.acme.staticforge.asset.media.MediaText;
import com.acme.staticforge.asset.media.MediaWriteResult;
import com.acme.staticforge.asset.media.TextMediaTypes;
import com.acme.staticforge.common.ProblemFactory;
import com.acme.staticforge.common.SfException;
import com.acme.staticforge.preview.PageRenderService;
import com.acme.staticforge.preview.PreviewTokenService;
import com.acme.staticforge.release.ContentView;
import com.acme.staticforge.release.ContentViews;
import com.acme.staticforge.project.LocaleConfig;
import com.acme.staticforge.project.Project;
import com.acme.staticforge.project.ProjectLocales;
import com.acme.staticforge.project.ProjectService;
import com.acme.staticforge.revision.RevisionContext;
import com.acme.staticforge.security.SecuritySupport;
import com.acme.staticforge.template.diagnostic.Diagnostic;
import com.fasterxml.jackson.databind.JsonNode;
import jakarta.servlet.http.HttpServletRequest;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.http.CacheControl;
import org.springframework.http.ContentDisposition;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

/**
 * Media endpoints (spec §20.2). Thin controller: resolves the project, delegates to
 * {@link MediaService}, and maps to media DTOs. Reads are {@code VIEWER}-gated, writes
 * {@code EDITOR}-gated. Binaries are served with the sniffed {@code Content-Type} and
 * {@code Content-Disposition: attachment} for non-renderable types (§11.5).
 */
@RestController
@RequestMapping("/api/v1/projects/{projectKey}/media")
public class MediaController {

    private static final int THUMBNAIL_CACHE_SECONDS = 86_400;

    /** Carries the diagnostic when a processed media file is served as its unrendered source (M18.3.2). */
    static final String RENDER_ERROR_HEADER = "X-SF-Render-Error";

    private final ProjectService projectService;
    private final MediaService mediaService;
    private final SecuritySupport securitySupport;
    private final PreviewTokenService previewTokenService;
    private final PageRenderService pageRenderService;
    private final ReleaseBlocks releaseBlocks;
    private final ContentViews contentViews;
    private final ProjectLocales projectLocales;

    public MediaController(
            ProjectService projectService,
            MediaService mediaService,
            SecuritySupport securitySupport,
            PreviewTokenService previewTokenService,
            PageRenderService pageRenderService,
            ReleaseBlocks releaseBlocks,
            ContentViews contentViews,
            ProjectLocales projectLocales) {
        this.projectService = projectService;
        this.mediaService = mediaService;
        this.securitySupport = securitySupport;
        this.previewTokenService = previewTokenService;
        this.pageRenderService = pageRenderService;
        this.releaseBlocks = releaseBlocks;
        this.contentViews = contentViews;
        this.projectLocales = projectLocales;
    }

    @GetMapping
    @PreAuthorize("@projectAuth.has(#projectKey, " + ProjectRoleExpr.VIEWER + ")")
    public Page<MediaSummaryView> list(
            @PathVariable String projectKey,
            @RequestParam(required = false) String mimeType,
            @RequestParam(required = false) String folder,
            @RequestParam(defaultValue = "false") boolean recursive,
            @RequestParam(required = false) String q,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "50") int size) {
        long projectId = projectId(projectKey);
        Page<AssetVersionView> result =
                mediaService.list(projectId, mimeType, folder, recursive, q, PageRequest.of(page, size));
        List<UUID> uuids = result.getContent().stream().map(AssetVersionView::uuid).toList();
        var release = releaseBlocks.of(projectId, uuids);
        var scheduled = releaseBlocks.scheduled(projectId, uuids);
        return result.map(v -> toSummary(v, release.get(v.uuid()), scheduled.getOrDefault(v.uuid(), List.of())));
    }

    @PostMapping
    @PreAuthorize("@projectAuth.has(#projectKey, " + ProjectRoleExpr.EDITOR + ")")
    public ResponseEntity<MediaView> upload(
            @PathVariable String projectKey,
            @RequestParam("file") MultipartFile file,
            @RequestParam(required = false) UUID folderUuid,
            @RequestParam(required = false) String altText,
            @RequestParam(required = false) String caption) {
        AssetVersionView view = mediaService.upload(
                projectId(projectKey),
                folderUuid,
                file.getOriginalFilename(),
                file.getContentType(),
                altText,
                caption,
                bytes(file),
                ctx(projectKey, "upload media"));
        return ResponseEntity.status(HttpStatus.CREATED).body(toMediaView(projectKey, view));
    }

    @PostMapping("/bulk")
    @PreAuthorize("@projectAuth.has(#projectKey, " + ProjectRoleExpr.EDITOR + ")")
    public ResponseEntity<List<MediaBulkItemResult>> bulk(
            @PathVariable String projectKey,
            @RequestParam("files") List<MultipartFile> files,
            @RequestParam(required = false) UUID folderUuid) {
        long projectId = projectId(projectKey);
        List<MediaBulkItemResult> results = new ArrayList<>();
        for (MultipartFile file : files) {
            try {
                AssetVersionView view = mediaService.upload(projectId, folderUuid, file.getOriginalFilename(),
                        file.getContentType(), null, null, bytes(file), ctx(projectKey, "bulk upload media"));
                results.add(new MediaBulkItemResult(file.getOriginalFilename(), toMediaView(projectKey, view), null, null, null));
            } catch (SfException e) {
                results.add(new MediaBulkItemResult(file.getOriginalFilename(), null, e.getStatus(),
                        e.getProblem().getExtensions().get("code") == null ? null
                                : String.valueOf(e.getProblem().getExtensions().get("code")),
                        e.getProblem().getDetail()));
            }
        }
        return ResponseEntity.ok(results);
    }

    @PutMapping("/{uuid}")
    @PreAuthorize("@projectAuth.has(#projectKey, " + ProjectRoleExpr.EDITOR + ")")
    public ResponseEntity<MediaView> updateMetadata(
            @PathVariable String projectKey,
            @PathVariable UUID uuid,
            @RequestHeader(value = "If-Match", required = false) String ifMatch,
            @org.springframework.web.bind.annotation.RequestParam(value = "locale", required = false) String locale,
            @org.springframework.web.bind.annotation.RequestBody MediaMetadataRequest body) {
        FocalPointView fp = body.focalPoint();
        AssetVersionView view = mediaService.updateMetadata(
                uuid,
                body.altText(),
                body.caption(),
                body.copyright(),
                fp == null ? null : FocalPoint.of(fp.x() == null ? 0.5 : fp.x(), fp.y() == null ? 0.5 : fp.y()),
                locale,
                RevisionHeaders.expectedRevision(ifMatch),
                ctx(projectKey, "update media metadata"));
        return ResponseEntity.ok()
                .header(HttpHeaders.ETAG, RevisionHeaders.etag(view.validFromRevision()))
                .body(toMediaView(projectKey, view));
    }

    /**
     * Swaps the file. A processed text file that stays text keeps {@code processCms} (its new source is
     * compiled: errors are a {@code 422} with {@code diagnostics}); otherwise the flag is switched off
     * and {@code processCmsCleared} says so.
     */
    @PostMapping("/{uuid}/replace")
    @PreAuthorize("@projectAuth.has(#projectKey, " + ProjectRoleExpr.EDITOR + ")")
    public ResponseEntity<MediaSaveResponse> replace(
            @PathVariable String projectKey,
            @PathVariable UUID uuid,
            @RequestParam("file") MultipartFile file) {
        MediaWriteResult result = mediaService.replace(
                uuid, file.getOriginalFilename(), file.getContentType(), bytes(file), ctx(projectKey, "replace media"));
        return saved(projectKey, result);
    }

    /**
     * Localizes or un-localizes the media asset (M27.3.1): one file per language, or one for all. Un-localizing
     * keeps the default language's file; the others are discarded only with {@code confirmDiscard}, else a
     * {@code 409 SF-MEDIA-0505} lists them ({@code files}). {@code 422 SF-MEDIA-0508} in a project without
     * languages.
     */
    @PutMapping("/{uuid}/localized")
    @PreAuthorize("@projectAuth.has(#projectKey, " + ProjectRoleExpr.EDITOR + ")")
    public ResponseEntity<MediaView> setLocalized(
            @PathVariable String projectKey,
            @PathVariable UUID uuid,
            @RequestHeader(value = "If-Match", required = false) String ifMatch,
            @org.springframework.web.bind.annotation.RequestBody MediaLocalizedRequest body) {
        AssetVersionView view = mediaService.setLocalized(
                uuid,
                body.localized(),
                Boolean.TRUE.equals(body.confirmDiscard()),
                RevisionHeaders.expectedRevision(ifMatch),
                ctx(projectKey, body.localized() ? "localize media" : "un-localize media"));
        return ResponseEntity.ok()
                .header(HttpHeaders.ETAG, RevisionHeaders.etag(view.validFromRevision()))
                .body(toMediaView(projectKey, view));
    }

    /**
     * Uploads or replaces one language's own file of localized media (M27.3.1), through the same upload rules as
     * {@code replace}. {@code 422 SF-MEDIA-0506} for media that isn't localized, {@code 0507} for a language the
     * project doesn't have.
     */
    @PostMapping("/{uuid}/files/{locale}")
    @PreAuthorize("@projectAuth.has(#projectKey, " + ProjectRoleExpr.EDITOR + ")")
    public ResponseEntity<MediaSaveResponse> putLocaleFile(
            @PathVariable String projectKey,
            @PathVariable UUID uuid,
            @PathVariable String locale,
            @RequestParam("file") MultipartFile file) {
        MediaWriteResult result = mediaService.putLocaleFile(
                uuid, locale, file.getOriginalFilename(), file.getContentType(), bytes(file),
                ctx(projectKey, "replace media file (" + locale + ")"));
        return saved(projectKey, result);
    }

    /**
     * Removes one language's own file of localized media, so the language falls back again (M27.3.1). The default
     * language's file can't be removed ({@code 422 SF-MEDIA-0509}); a language without its own file changes nothing.
     */
    @DeleteMapping("/{uuid}/files/{locale}")
    @PreAuthorize("@projectAuth.has(#projectKey, " + ProjectRoleExpr.EDITOR + ")")
    public ResponseEntity<MediaView> removeLocaleFile(
            @PathVariable String projectKey, @PathVariable UUID uuid, @PathVariable String locale) {
        AssetVersionView view = mediaService.removeLocaleFile(
                uuid, locale, ctx(projectKey, "remove media file (" + locale + ")"));
        return ResponseEntity.ok()
                .header(HttpHeaders.ETAG, RevisionHeaders.etag(view.validFromRevision()))
                .body(toMediaView(projectKey, view));
    }

    /**
     * Switches CMS syntax processing of a text media file on or off (M18.1.1). Non-text files are a
     * {@code 400}. Switching on compiles the file: errors are a {@code 422} with {@code diagnostics}
     * and leave the flag off; warnings ({@code $$}, unescaped JS/JSON values) come back in the response.
     */
    @PutMapping("/{uuid}/process")
    @PreAuthorize("@projectAuth.has(#projectKey, " + ProjectRoleExpr.EDITOR + ")")
    public ResponseEntity<MediaSaveResponse> setProcessCms(
            @PathVariable String projectKey,
            @PathVariable UUID uuid,
            @RequestHeader(value = "If-Match", required = false) String ifMatch,
            @RequestParam(required = false) String locale,
            @org.springframework.web.bind.annotation.RequestBody MediaProcessRequest body) {
        MediaWriteResult result = mediaService.setProcessCms(
                uuid,
                body.processCms(),
                locale,
                RevisionHeaders.expectedRevision(ifMatch),
                ctx(projectKey, body.processCms() ? "enable CMS processing" : "disable CMS processing"));
        return saved(projectKey, result);
    }

    /**
     * A text media file's content, current or at {@code ?revision=} (M18.1.2); non-text files are a {@code 400}. For
     * localized media, {@code ?locale=} reads the file that language renders (M27.3.1; default: the default file).
     */
    @GetMapping("/{uuid}/text")
    @PreAuthorize("@projectAuth.has(#projectKey, " + ProjectRoleExpr.VIEWER + ")")
    public ResponseEntity<MediaTextView> readText(
            @PathVariable String projectKey,
            @PathVariable UUID uuid,
            @RequestParam(required = false) Long revision,
            @RequestParam(required = false) String locale) {
        MediaText text = mediaService.readText(projectId(projectKey), uuid, revision, locale);
        return ResponseEntity.ok()
                .header(HttpHeaders.ETAG, RevisionHeaders.etag(text.revision()))
                .body(new MediaTextView(text.text(), text.mimeType(), text.revision(), text.utf8()));
    }

    /**
     * Replaces a text media file's content (M18.1.2); every change is one revision. A processed file's
     * new source is compiled first: errors are a {@code 422} with {@code diagnostics} and nothing is stored. For
     * localized media, {@code ?locale=} writes that language's own file (M27.3.1).
     */
    @PutMapping("/{uuid}/text")
    @PreAuthorize("@projectAuth.has(#projectKey, " + ProjectRoleExpr.EDITOR + ")")
    public ResponseEntity<MediaSaveResponse> writeText(
            @PathVariable String projectKey,
            @PathVariable UUID uuid,
            @RequestHeader(value = "If-Match", required = false) String ifMatch,
            @RequestParam(required = false) String locale,
            @org.springframework.web.bind.annotation.RequestBody MediaTextRequest body) {
        MediaWriteResult result = mediaService.writeText(
                uuid, body.text(), locale, RevisionHeaders.expectedRevision(ifMatch), ctx(projectKey, "edit media text"));
        return saved(projectKey, result);
    }

    /** Compiles draft text as this text media file's CMS syntax source, without saving (M18.2.1). */
    @AllowedOnArchivedProject("Validates a draft, stores nothing.")
    @PostMapping("/{uuid}/text/validate")
    @PreAuthorize("@projectAuth.has(#projectKey, " + ProjectRoleExpr.EDITOR + ")")
    public OctlValidateResponse validateText(
            @PathVariable String projectKey,
            @PathVariable UUID uuid,
            @org.springframework.web.bind.annotation.RequestBody MediaTextRequest body) {
        return new OctlValidateResponse(mediaService.validateText(projectId(projectKey), uuid, body.text()));
    }

    /**
     * The rendered output of a processed text media file (M18.3.2), as preview serves it: values at
     * {@code ?revision=} (current when absent) and media links rewritten to preview share URLs. For the
     * media drawer's Rendered tab; {@code EDITOR}, since it exposes the output of the file's source.
     * A file that isn't processed is a {@code 400}; a source that doesn't compile or render is a
     * {@code 422} with {@code diagnostics} (or the render limit's code). The plain {@code /binary}
     * route keeps serving the source. For localized media, {@code ?locale=} renders that language's file in that
     * language (M27.3.2).
     */
    @GetMapping(value = "/{uuid}/binary", params = "rendered=true")
    @PreAuthorize("@projectAuth.has(#projectKey, " + ProjectRoleExpr.EDITOR + ")")
    public ResponseEntity<byte[]> renderedBinary(
            @PathVariable String projectKey,
            @PathVariable UUID uuid,
            @RequestParam(required = false) Long revision,
            @RequestParam(required = false) String locale,
            HttpServletRequest request) {
        long projectId = projectId(projectKey);
        AssetVersionView media = mediaService.requireAt(projectId, uuid, revision);
        JsonNode file = fileOf(projectId, media, locale);
        if (!TextMediaTypes.isProcessed(file)) {
            throw new SfException(ProblemFactory.badRequest("This media file does not have CMS processing switched on."));
        }
        String rendered = pageRenderService.renderMedia(
                projectId, media, revision, apiBase(request), locale, ContentView.Kind.DRAFT);
        return renderedResponse(text(file, "mimeType"), rendered.getBytes(StandardCharsets.UTF_8), null);
    }

    /** The payload of {@code media} as {@code locale} renders it: localized media's file for that language (M27.3.2). */
    private JsonNode fileOf(long projectId, AssetVersionView media, String locale) {
        return MediaFiles.effective(media.payload(), locale, projectLocales.forProject(projectId).effectiveChain(locale));
    }

    @GetMapping("/{uuid}/binary")
    @PreAuthorize("@projectAuth.has(#projectKey, " + ProjectRoleExpr.VIEWER + ")")
    public ResponseEntity<byte[]> binary(
            @PathVariable String projectKey, @PathVariable UUID uuid,
            @RequestParam(required = false) String variant,
            @RequestParam(required = false) String locale) {
        MediaBinary binary = mediaService.binary(projectId(projectKey), uuid, variant, null, locale);
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.parseMediaType(binary.mimeType()));
        if (!isRenderable(binary.mimeType())) {
            headers.setContentDisposition(ContentDisposition.attachment().filename(binary.fileName()).build());
        }
        return new ResponseEntity<>(binary.bytes(), headers, HttpStatus.OK);
    }

    /**
     * Public, token-gated binary route (spec §19.3, mirroring {@code PreviewController#share}):
     * MEDIA references inside rendered preview HTML are rewritten to this route by
     * {@code PageRenderService}'s {@code urlResolver}, since the browser's own frame navigation /
     * {@code <img src>} fetch of that HTML doesn't carry the app's Bearer session. Reachable
     * without one — {@code SecurityConfig} permits {@code GET .../media/*}/share} at the
     * filter-chain level, since method-level {@code @PreAuthorize} alone can't achieve that.
     *
     * <p>The file is served at the token's revision (current when the token carries none). A
     * processed text media file (M18.3.2) is rendered first, with {@code Cache-Control: no-store}
     * because its output depends on other assets. When it fails to compile or render, the source is
     * served instead with the diagnostic in {@code X-SF-Render-Error}, so one broken stylesheet
     * doesn't break the whole preview.
     *
     * <p>A token from a published preview (M27.2.3) serves the version released in its language — {@code 404} when
     * none is — and renders a processed file in the published view. Localized media serves the file of the token's
     * language (M27.3.2).
     */
    @GetMapping("/{uuid}/share")
    @PreAuthorize("permitAll()")
    public ResponseEntity<byte[]> shareBinary(
            @PathVariable String projectKey,
            @PathVariable UUID uuid,
            @RequestParam("t") String token,
            @RequestParam(required = false) String variant,
            HttpServletRequest request) {
        PreviewTokenService.ShareTarget target = previewTokenService.verifyMediaShareToken(token);
        if (!target.pageUuid().equals(uuid) || (target.projectKey() != null && !target.projectKey().equals(projectKey))) {
            throw new SfException(ProblemFactory.unauthorized("Invalid share token."));
        }
        long projectId = sharedProjectId(projectKey);
        // The version the link's view shows, and the revision it is valid at (its own first revision when released).
        AssetVersionView media;
        Long revision = target.revision();
        if (target.view() == ContentView.Kind.PUBLISHED) {
            media = contentViews.open(projectId, target.revision(), ContentView.Kind.PUBLISHED, target.locale())
                    .resolve(uuid)
                    .map(ContentView.Resolved::view)
                    .orElseThrow(() -> new SfException(ProblemFactory.notFound("Media not published.")));
            revision = media.validFromRevision();
        } else {
            media = mediaService.requireAt(projectId, uuid, revision);
        }
        if ((variant == null || variant.isBlank()) && TextMediaTypes.isProcessed(fileOf(projectId, media, target.locale()))) {
            return sharedProcessed(projectId, media, target, request);
        }
        MediaBinary binary = mediaService.binary(projectId, uuid, variant, revision, target.locale());
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.parseMediaType(binary.mimeType()));
        if (!isRenderable(binary.mimeType())) {
            headers.setContentDisposition(ContentDisposition.attachment().filename(binary.fileName()).build());
        }
        return new ResponseEntity<>(binary.bytes(), headers, HttpStatus.OK);
    }

    private ResponseEntity<byte[]> sharedProcessed(
            long projectId, AssetVersionView media, PreviewTokenService.ShareTarget target, HttpServletRequest request) {
        String mimeType = text(fileOf(projectId, media, target.locale()), "mimeType");
        try {
            String rendered = pageRenderService.renderMedia(
                    projectId, media, target.revision(), apiBase(request), target.locale(), target.view());
            return renderedResponse(mimeType, rendered.getBytes(StandardCharsets.UTF_8), null);
        } catch (SfException e) {
            MediaBinary source = mediaService.binary(
                    projectId, media.uuid(), null, media.validFromRevision(), target.locale());
            return renderedResponse(mimeType, source.bytes(), renderErrorSummary(e));
        }
    }

    private static ResponseEntity<byte[]> renderedResponse(String mimeType, byte[] bytes, String renderError) {
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.parseMediaType(mimeType));
        headers.setCacheControl(CacheControl.noStore());
        if (renderError != null) {
            headers.set(RENDER_ERROR_HEADER, renderError);
        }
        return new ResponseEntity<>(bytes, headers, HttpStatus.OK);
    }

    /** {@code code: message} of the first diagnostic (or the problem detail), reduced to a single header-safe line. */
    private static String renderErrorSummary(SfException e) {
        Object diagnostics = e.getProblem().getExtensions().get("diagnostics");
        String summary;
        if (diagnostics instanceof List<?> list && !list.isEmpty() && list.get(0) instanceof Diagnostic first) {
            summary = first.code() + " " + first.line() + ":" + first.column() + " " + first.message();
        } else {
            Object code = e.getProblem().getExtensions().get("code");
            summary = (code == null ? "" : code + " ") + e.getProblem().getDetail();
        }
        String ascii = summary.replaceAll("[^\\x20-\\x7E]", " ");
        return ascii.length() > 500 ? ascii.substring(0, 500) : ascii;
    }

    private static String apiBase(HttpServletRequest request) {
        String url = request.getRequestURL().toString();
        int idx = url.indexOf("/projects/");
        return idx < 0 ? "" : url.substring(0, idx);
    }

    @GetMapping("/{uuid}/thumbnail")
    @PreAuthorize("@projectAuth.has(#projectKey, " + ProjectRoleExpr.VIEWER + ")")
    public ResponseEntity<byte[]> thumbnail(
            @PathVariable String projectKey, @PathVariable UUID uuid, @RequestParam(required = false) String locale) {
        MediaBinary thumb = mediaService.thumbnail(projectId(projectKey), uuid, locale);
        return ResponseEntity.ok()
                .contentType(MediaType.parseMediaType(thumb.mimeType()))
                .header(HttpHeaders.CACHE_CONTROL, "private, max-age=" + THUMBNAIL_CACHE_SECONDS)
                .body(thumb.bytes());
    }

    private ResponseEntity<MediaSaveResponse> saved(String projectKey, MediaWriteResult result) {
        return ResponseEntity.ok()
                .header(HttpHeaders.ETAG, RevisionHeaders.etag(result.media().validFromRevision()))
                .body(new MediaSaveResponse(
                        toMediaView(projectKey, result.media()), result.warnings(), result.processCmsCleared()));
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

    private RevisionContext ctx(String key, String comment) {
        return RevisionContext.of(projectId(key), securitySupport.currentUserId(), comment);
    }

    private static byte[] bytes(MultipartFile file) {
        try {
            return file.getBytes();
        } catch (IOException e) {
            throw new SfException(
                    com.acme.staticforge.common.ProblemFactory.badRequest("Failed to read uploaded file."),
                    e.getMessage(), e);
        }
    }

    private static boolean isRenderable(String mimeType) {
        if (mimeType == null) {
            return false;
        }
        return mimeType.startsWith("image/")
                || mimeType.startsWith("video/")
                || mimeType.startsWith("audio/")
                || mimeType.startsWith("text/")
                || mimeType.startsWith("font/")
                || "application/pdf".equals(mimeType)
                || "application/javascript".equals(mimeType);
    }

    private MediaSummaryView toSummary(
            AssetVersionView v,
            java.util.Map<String, com.acme.staticforge.api.dto.LocaleReleaseView> release,
            List<ScheduledRefView> scheduled) {
        JsonNode payload = v.payload();
        return new MediaSummaryView(
                v.uuid(),
                v.uid(),
                v.displayName(),
                payload == null ? null : text(payload, "mimeType"),
                payload == null ? null : longOrNull(payload, "sizeBytes"),
                v.folderPath(),
                v.validFromRevision(),
                TextMediaTypes.isProcessed(payload),
                payload != null && TextMediaTypes.isText(text(payload, "mimeType")),
                MediaFiles.isLocalized(payload),
                release,
                scheduled);
    }

    private MediaView toMediaView(String projectKey, AssetVersionView v) {
        long projectId = projectId(projectKey);
        return toMediaView(v, null, releaseBlocks.of(projectId, v.uuid()), releaseBlocks.scheduled(projectId, v.uuid()),
                projectLocales.forProject(projectId));
    }

    /**
     * {@code locale} resolves {@code altText}/{@code caption} for one language; {@code null} takes
     * the first stored language, which is what a project without locales has anyway (M24.2.2).
     */
    private static MediaView toMediaView(
            AssetVersionView v,
            java.util.List<String> locale,
            java.util.Map<String, com.acme.staticforge.api.dto.LocaleReleaseView> release,
            List<ScheduledRefView> scheduled,
            LocaleConfig locales) {
        JsonNode payload = v.payload();
        return new MediaView(
                v.uuid(),
                v.uid(),
                v.displayName(),
                v.validFromRevision(),
                text(payload, "blobSha256"),
                text(payload, "fileName"),
                text(payload, "mimeType"),
                longVal(payload, "sizeBytes"),
                image(payload),
                localizedText(payload, "altText", locale),
                localizedText(payload, "caption", locale),
                text(payload, "copyright"),
                localizedMap(payload, "altText"),
                localizedMap(payload, "caption"),
                focalPoint(payload),
                variants(payload),
                TextMediaTypes.isProcessed(payload),
                TextMediaTypes.isText(text(payload, "mimeType")),
                MediaFiles.isLocalized(payload),
                localeFiles(payload, locales),
                release,
                scheduled);
    }

    /**
     * The file every project language renders of localized media, own or by fallback (M27.3.1); {@code null} for
     * media that isn't localized.
     */
    private static java.util.Map<String, MediaLocaleFileView> localeFiles(JsonNode payload, LocaleConfig locales) {
        if (!MediaFiles.isLocalized(payload)) {
            return null;
        }
        java.util.Map<String, MediaLocaleFileView> out = new java.util.LinkedHashMap<>();
        for (String locale : LocaleConfig.orEmpty(locales).codes()) {
            MediaFiles.Resolved resolved = MediaFiles.fileFor(payload, locale, locales.effectiveChain(locale));
            JsonNode file = resolved.file();
            out.put(locale, new MediaLocaleFileView(
                    resolved.own(),
                    resolved.locale(),
                    text(file, "blobSha256"),
                    text(file, "fileName"),
                    text(file, "mimeType"),
                    longVal(file, "sizeBytes"),
                    image(file),
                    TextMediaTypes.isProcessed(file),
                    TextMediaTypes.isText(text(file, "mimeType"))));
        }
        return out;
    }

    private static MediaImageView image(JsonNode payload) {
        JsonNode img = payload == null ? null : payload.get("image");
        if (img == null || img.isNull()) {
            return null;
        }
        return new MediaImageView(
                intOrNull(img, "width"), intOrNull(img, "height"), intOrNull(img, "orientation"),
                text(img, "dominantColor"));
    }

    private static FocalPointView focalPoint(JsonNode payload) {
        JsonNode fp = payload == null ? null : payload.get("focalPoint");
        if (fp == null || fp.isNull()) {
            return new FocalPointView(0.5, 0.5);
        }
        return new FocalPointView(doubleOrNull(fp, "x"), doubleOrNull(fp, "y"));
    }

    private static List<MediaVariantView> variants(JsonNode payload) {
        JsonNode arr = payload == null ? null : payload.get("variants");
        List<MediaVariantView> out = new ArrayList<>();
        if (arr != null && arr.isArray()) {
            for (JsonNode node : arr) {
                out.add(new MediaVariantView(
                        text(node, "name"), text(node, "blobSha256"), intOrNull(node, "width"), text(node, "format")));
            }
        }
        return out;
    }

    private static String text(JsonNode node, String field) {
        return node != null && node.hasNonNull(field) ? node.get(field).asText() : null;
    }

    private static Integer intOrNull(JsonNode node, String field) {
        return node != null && node.hasNonNull(field) ? node.get(field).asInt() : null;
    }

    private static Long longOrNull(JsonNode node, String field) {
        return node != null && node.hasNonNull(field) ? node.get(field).asLong() : null;
    }

    private static Double doubleOrNull(JsonNode node, String field) {
        return node != null && node.hasNonNull(field) ? node.get(field).asDouble() : null;
    }

    private static long longVal(JsonNode node, String field) {
        return node != null && node.hasNonNull(field) ? node.get(field).asLong() : 0L;
    }

    /** A media metadata field resolved for {@code chain}; a plain string passes through unchanged. */
    private static String localizedText(JsonNode payload, String field, java.util.List<String> chain) {
        JsonNode value = payload == null ? null : payload.get(field);
        if (!com.acme.staticforge.common.L10nValues.isL10n(value)) {
            return value == null || value.isNull() ? null : value.asText();
        }
        java.util.List<String> lookup = chain != null && !chain.isEmpty()
                ? chain
                : com.acme.staticforge.common.L10nValues.locales(value);
        JsonNode resolved = com.acme.staticforge.common.L10nValues.resolve(value, lookup);
        return resolved == null ? null : resolved.asText();
    }

    /** The per-language values of a media metadata field, or {@code null} when it is not localized. */
    private static java.util.Map<String, String> localizedMap(JsonNode payload, String field) {
        JsonNode value = payload == null ? null : payload.get(field);
        if (!com.acme.staticforge.common.L10nValues.isL10n(value)) {
            return null;
        }
        java.util.Map<String, String> out = new java.util.LinkedHashMap<>();
        for (String locale : com.acme.staticforge.common.L10nValues.locales(value)) {
            out.put(locale, com.acme.staticforge.common.L10nValues.get(value, locale).asText());
        }
        return out;
    }
}
