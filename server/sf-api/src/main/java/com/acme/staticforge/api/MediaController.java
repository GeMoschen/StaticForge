package com.acme.staticforge.api;

import com.acme.staticforge.api.dto.FocalPointView;
import com.acme.staticforge.api.dto.MediaBulkItemResult;
import com.acme.staticforge.api.dto.MediaImageView;
import com.acme.staticforge.api.dto.MediaMetadataRequest;
import com.acme.staticforge.api.dto.MediaSummaryView;
import com.acme.staticforge.api.dto.MediaVariantView;
import com.acme.staticforge.api.dto.MediaView;
import com.acme.staticforge.asset.AssetVersionView;
import com.acme.staticforge.asset.media.FocalPoint;
import com.acme.staticforge.asset.media.MediaBinary;
import com.acme.staticforge.asset.media.MediaService;
import com.acme.staticforge.common.ProblemFactory;
import com.acme.staticforge.common.SfException;
import com.acme.staticforge.preview.PreviewTokenService;
import com.acme.staticforge.project.ProjectService;
import com.acme.staticforge.revision.RevisionContext;
import com.acme.staticforge.security.SecuritySupport;
import com.fasterxml.jackson.databind.JsonNode;
import java.io.IOException;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
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

    private final ProjectService projectService;
    private final MediaService mediaService;
    private final SecuritySupport securitySupport;
    private final PreviewTokenService previewTokenService;

    public MediaController(
            ProjectService projectService,
            MediaService mediaService,
            SecuritySupport securitySupport,
            PreviewTokenService previewTokenService) {
        this.projectService = projectService;
        this.mediaService = mediaService;
        this.securitySupport = securitySupport;
        this.previewTokenService = previewTokenService;
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
            @org.springframework.web.bind.annotation.RequestBody MediaMetadataRequest body) {
        FocalPointView fp = body.focalPoint();
        AssetVersionView view = mediaService.updateMetadata(
                uuid,
                body.altText(),
                body.caption(),
                body.copyright(),
                fp == null ? null : FocalPoint.of(fp.x() == null ? 0.5 : fp.x(), fp.y() == null ? 0.5 : fp.y()),
                RevisionHeaders.expectedRevision(ifMatch),
                ctx(projectKey, "update media metadata"));
        return ResponseEntity.ok()
                .header(HttpHeaders.ETAG, RevisionHeaders.etag(view.validFromRevision()))
                .body(toMediaView(view));
    }

    @PostMapping("/{uuid}/replace")
    @PreAuthorize("@projectAuth.has(#projectKey, " + ProjectRoleExpr.EDITOR + ")")
    public ResponseEntity<MediaView> replace(
            @PathVariable String projectKey,
            @PathVariable UUID uuid,
            @RequestParam("file") MultipartFile file) {
        AssetVersionView view = mediaService.replace(
                uuid, file.getOriginalFilename(), file.getContentType(), bytes(file), ctx(projectKey, "replace media"));
        return ResponseEntity.ok()
                .header(HttpHeaders.ETAG, RevisionHeaders.etag(view.validFromRevision()))
                .body(toMediaView(view));
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
     */
    @GetMapping("/{uuid}/share")
    @PreAuthorize("permitAll()")
    public ResponseEntity<byte[]> shareBinary(
            @PathVariable String projectKey,
            @PathVariable UUID uuid,
            @RequestParam("t") String token,
            @RequestParam(required = false) String variant) {
        PreviewTokenService.ShareTarget target = previewTokenService.verifyMediaShareToken(token);
        if (!target.pageUuid().equals(uuid) || (target.projectKey() != null && !target.projectKey().equals(projectKey))) {
            throw new SfException(ProblemFactory.unauthorized("Invalid share token."));
        }
        MediaBinary binary = mediaService.binary(projectId(projectKey), uuid, variant);
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.parseMediaType(binary.mimeType()));
        if (!isRenderable(binary.mimeType())) {
            headers.setContentDisposition(ContentDisposition.attachment().filename(binary.fileName()).build());
        }
        return new ResponseEntity<>(binary.bytes(), headers, HttpStatus.OK);
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
                v.validFromRevision());
    }

    private static MediaView toMediaView(AssetVersionView v) {
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
                text(payload, "altText"),
                text(payload, "caption"),
                text(payload, "copyright"),
                focalPoint(payload),
                variants(payload));
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
}
