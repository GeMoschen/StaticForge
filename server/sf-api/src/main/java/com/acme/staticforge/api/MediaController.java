package com.acme.staticforge.api;

import com.acme.staticforge.api.dto.FocalPointView;
import com.acme.staticforge.api.dto.MediaBulkItemResult;
import com.acme.staticforge.api.dto.MediaImageView;
import com.acme.staticforge.api.dto.MediaMetadataRequest;
import com.acme.staticforge.api.dto.MediaProcessRequest;
import com.acme.staticforge.api.dto.MediaSaveResponse;
import com.acme.staticforge.api.dto.MediaSummaryView;
import com.acme.staticforge.api.dto.MediaVariantView;
import com.acme.staticforge.api.dto.MediaTextRequest;
import com.acme.staticforge.api.dto.MediaTextView;
import com.acme.staticforge.api.dto.MediaView;
import com.acme.staticforge.api.dto.OctlValidateResponse;
import com.acme.staticforge.asset.AssetVersionView;
import com.acme.staticforge.asset.media.FocalPoint;
import com.acme.staticforge.asset.media.MediaBinary;
import com.acme.staticforge.asset.media.MediaService;
import com.acme.staticforge.asset.media.MediaText;
import com.acme.staticforge.asset.media.MediaWriteResult;
import com.acme.staticforge.asset.media.TextMediaTypes;
import com.acme.staticforge.common.ProblemFactory;
import com.acme.staticforge.common.SfException;
import com.acme.staticforge.preview.PageRenderService;
import com.acme.staticforge.preview.PreviewTokenService;
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

    public MediaController(
            ProjectService projectService,
            MediaService mediaService,
            SecuritySupport securitySupport,
            PreviewTokenService previewTokenService,
            PageRenderService pageRenderService) {
        this.projectService = projectService;
        this.mediaService = mediaService;
        this.securitySupport = securitySupport;
        this.previewTokenService = previewTokenService;
        this.pageRenderService = pageRenderService;
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
        return mediaService
                .list(projectId(projectKey), mimeType, folder, recursive, q, PageRequest.of(page, size))
                .map(this::toSummary);
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
        return ResponseEntity.status(HttpStatus.CREATED).body(toMediaView(view));
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
                results.add(new MediaBulkItemResult(file.getOriginalFilename(), toMediaView(view), null, null, null));
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
                .body(toMediaView(view));
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
        return saved(result);
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
            @org.springframework.web.bind.annotation.RequestBody MediaProcessRequest body) {
        MediaWriteResult result = mediaService.setProcessCms(
                uuid,
                body.processCms(),
                RevisionHeaders.expectedRevision(ifMatch),
                ctx(projectKey, body.processCms() ? "enable CMS processing" : "disable CMS processing"));
        return saved(result);
    }

    /** A text media file's content, current or at {@code ?revision=} (M18.1.2); non-text files are a {@code 400}. */
    @GetMapping("/{uuid}/text")
    @PreAuthorize("@projectAuth.has(#projectKey, " + ProjectRoleExpr.VIEWER + ")")
    public ResponseEntity<MediaTextView> readText(
            @PathVariable String projectKey,
            @PathVariable UUID uuid,
            @RequestParam(required = false) Long revision) {
        MediaText text = mediaService.readText(projectId(projectKey), uuid, revision);
        return ResponseEntity.ok()
                .header(HttpHeaders.ETAG, RevisionHeaders.etag(text.revision()))
                .body(new MediaTextView(text.text(), text.mimeType(), text.revision(), text.utf8()));
    }

    /**
     * Replaces a text media file's content (M18.1.2); every change is one revision. A processed file's
     * new source is compiled first: errors are a {@code 422} with {@code diagnostics} and nothing is stored.
     */
    @PutMapping("/{uuid}/text")
    @PreAuthorize("@projectAuth.has(#projectKey, " + ProjectRoleExpr.EDITOR + ")")
    public ResponseEntity<MediaSaveResponse> writeText(
            @PathVariable String projectKey,
            @PathVariable UUID uuid,
            @RequestHeader(value = "If-Match", required = false) String ifMatch,
            @org.springframework.web.bind.annotation.RequestBody MediaTextRequest body) {
        MediaWriteResult result = mediaService.writeText(
                uuid, body.text(), RevisionHeaders.expectedRevision(ifMatch), ctx(projectKey, "edit media text"));
        return saved(result);
    }

    /** Compiles draft text as this text media file's CMS syntax source, without saving (M18.2.1). */
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
     * route keeps serving the source.
     */
    @GetMapping(value = "/{uuid}/binary", params = "rendered=true")
    @PreAuthorize("@projectAuth.has(#projectKey, " + ProjectRoleExpr.EDITOR + ")")
    public ResponseEntity<byte[]> renderedBinary(
            @PathVariable String projectKey,
            @PathVariable UUID uuid,
            @RequestParam(required = false) Long revision,
            HttpServletRequest request) {
        long projectId = projectId(projectKey);
        AssetVersionView media = mediaService.requireAt(projectId, uuid, revision);
        if (!TextMediaTypes.isProcessed(media.payload())) {
            throw new SfException(ProblemFactory.badRequest("This media file does not have CMS processing switched on."));
        }
        String rendered = pageRenderService.renderMedia(projectId, media, revision, apiBase(request));
        return renderedResponse(media, rendered.getBytes(StandardCharsets.UTF_8), null);
    }

    @GetMapping("/{uuid}/binary")
    @PreAuthorize("@projectAuth.has(#projectKey, " + ProjectRoleExpr.VIEWER + ")")
    public ResponseEntity<byte[]> binary(
            @PathVariable String projectKey, @PathVariable UUID uuid,
            @RequestParam(required = false) String variant) {
        MediaBinary binary = mediaService.binary(projectId(projectKey), uuid, variant);
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
        long projectId = projectId(projectKey);
        if (variant == null || variant.isBlank()) {
            AssetVersionView media = mediaService.requireAt(projectId, uuid, target.revision());
            if (TextMediaTypes.isProcessed(media.payload())) {
                return sharedProcessed(projectId, media, target.revision(), request);
            }
        }
        MediaBinary binary = mediaService.binary(projectId, uuid, variant, target.revision());
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.parseMediaType(binary.mimeType()));
        if (!isRenderable(binary.mimeType())) {
            headers.setContentDisposition(ContentDisposition.attachment().filename(binary.fileName()).build());
        }
        return new ResponseEntity<>(binary.bytes(), headers, HttpStatus.OK);
    }

    private ResponseEntity<byte[]> sharedProcessed(
            long projectId, AssetVersionView media, Long revision, HttpServletRequest request) {
        try {
            String rendered = pageRenderService.renderMedia(projectId, media, revision, apiBase(request));
            return renderedResponse(media, rendered.getBytes(StandardCharsets.UTF_8), null);
        } catch (SfException e) {
            MediaBinary source = mediaService.binary(projectId, media.uuid(), null, revision);
            return renderedResponse(media, source.bytes(), renderErrorSummary(e));
        }
    }

    private static ResponseEntity<byte[]> renderedResponse(AssetVersionView media, byte[] bytes, String renderError) {
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.parseMediaType(text(media.payload(), "mimeType")));
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
    public ResponseEntity<byte[]> thumbnail(@PathVariable String projectKey, @PathVariable UUID uuid) {
        MediaBinary thumb = mediaService.thumbnail(projectId(projectKey), uuid);
        return ResponseEntity.ok()
                .contentType(MediaType.parseMediaType(thumb.mimeType()))
                .header(HttpHeaders.CACHE_CONTROL, "private, max-age=" + THUMBNAIL_CACHE_SECONDS)
                .body(thumb.bytes());
    }

    private static ResponseEntity<MediaSaveResponse> saved(MediaWriteResult result) {
        return ResponseEntity.ok()
                .header(HttpHeaders.ETAG, RevisionHeaders.etag(result.media().validFromRevision()))
                .body(new MediaSaveResponse(toMediaView(result.media()), result.warnings(), result.processCmsCleared()));
    }

    private long projectId(String key) {
        return projectService.requireByKey(key).getId();
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

    private MediaSummaryView toSummary(AssetVersionView v) {
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
                payload != null && TextMediaTypes.isText(text(payload, "mimeType")));
    }

    private static MediaView toMediaView(AssetVersionView v) {
        return toMediaView(v, null);
    }

    /**
     * {@code locale} resolves {@code altText}/{@code caption} for one language; {@code null} takes
     * the first stored language, which is what a project without locales has anyway (M24.2.2).
     */
    private static MediaView toMediaView(AssetVersionView v, java.util.List<String> locale) {
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
                TextMediaTypes.isText(text(payload, "mimeType")));
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
