package com.acme.staticforge.asset.media;

import com.acme.staticforge.asset.Asset;
import com.acme.staticforge.asset.AssetRepository;
import com.acme.staticforge.asset.AssetService;
import com.acme.staticforge.asset.AssetType;
import com.acme.staticforge.asset.AssetVersion;
import com.acme.staticforge.asset.AssetVersionView;
import com.acme.staticforge.asset.CreateAssetCommand;
import com.acme.staticforge.asset.UpdateAssetCommand;
import com.acme.staticforge.common.JsonUtil;
import com.acme.staticforge.common.ProblemFactory;
import com.acme.staticforge.common.SfException;
import com.acme.staticforge.project.Project;
import com.acme.staticforge.project.ProjectRepository;
import com.acme.staticforge.revision.RevisionAware;
import com.acme.staticforge.revision.RevisionContext;
import com.acme.staticforge.template.diagnostic.Diagnostic;
import com.acme.staticforge.template.octl.OctlResult;
import com.drew.imaging.ImageMetadataReader;
import com.drew.metadata.Metadata;
import com.drew.metadata.exif.ExifIFD0Directory;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import io.micrometer.core.instrument.Counter;
import io.micrometer.core.instrument.MeterRegistry;
import java.awt.Color;
import java.awt.Graphics2D;
import java.awt.RenderingHints;
import java.awt.image.BufferedImage;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.UUID;
import javax.imageio.IIOImage;
import javax.imageio.ImageIO;
import javax.imageio.ImageWriteParam;
import javax.imageio.ImageWriter;
import javax.imageio.stream.ImageOutputStream;
import org.apache.tika.Tika;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * {@link MediaService} implementation. Owns the full upload flow (spec §11.4): SHA-256, Tika
 * MIME sniffing (client type never trusted), allow-list + size-cap enforcement, EXIF strip
 * (re-encode for JPEG/PNG, sanitize for SVG), metadata extraction, and variant generation.
 * Persists media as a revisioned {@code MEDIA} asset through {@link AssetService}; the
 * {@code mime_type}/{@code size_bytes} denormalized columns are backfilled here after the
 * asset row is created so the media library search can filter by MIME family.
 */
@Service
@RevisionAware
public class MediaServiceImpl implements MediaService {

    private static final Logger LOG = LoggerFactory.getLogger(MediaServiceImpl.class);

    private final AssetService assetService;
    private final AssetRepository assetRepository;
    private final MediaVersionRepository mediaVersionRepository;
    private final BlobRepository blobRepository;
    private final BlobStore blobStore;
    private final MediaProperties properties;
    private final ProjectRepository projectRepository;
    private final TextMediaCompiler textMediaCompiler;
    private final SvgSanitizer svgSanitizer = new SvgSanitizer();
    private final ObjectMapper mapper = new ObjectMapper();
    private final Tika tika = new Tika();
    private final Counter uploadBytesCounter;

    public MediaServiceImpl(AssetService assetService, AssetRepository assetRepository,
            MediaVersionRepository mediaVersionRepository, BlobRepository blobRepository,
            BlobStore blobStore, MediaProperties properties, ProjectRepository projectRepository,
            TextMediaCompiler textMediaCompiler, MeterRegistry meterRegistry) {
        this.assetService = assetService;
        this.assetRepository = assetRepository;
        this.mediaVersionRepository = mediaVersionRepository;
        this.blobRepository = blobRepository;
        this.blobStore = blobStore;
        this.properties = properties;
        this.projectRepository = projectRepository;
        this.textMediaCompiler = textMediaCompiler;
        this.uploadBytesCounter = Counter.builder("sf.media.upload.bytes")
                .description("Bytes of media uploaded (spec §26.4).")
                .register(meterRegistry);
    }

    @Override
    @Transactional
    public AssetVersionView upload(long projectId, UUID folderUuid, String fileName,
            String suppliedMimeType, byte[] bytes, RevisionContext ctx) {
        return upload(projectId, folderUuid, fileName, suppliedMimeType, null, null, bytes, ctx);
    }

    @Override
    @Transactional
    public AssetVersionView upload(long projectId, UUID folderUuid, String fileName,
            String suppliedMimeType, String altText, String caption, byte[] bytes, RevisionContext ctx) {
        return doUpload(projectId, folderUuid, fileName, suppliedMimeType, altText, caption, bytes, ctx);
    }

    @Override
    @Transactional
    public AssetVersionView upload(long projectId, UUID folderUuid, String fileName,
            String suppliedMimeType, String altText, String caption, InputStream in, RevisionContext ctx) {
        byte[] bytes;
        try {
            bytes = in.readAllBytes();
        } catch (IOException e) {
            throw new SfException(
                    ProblemFactory.badRequest("Failed to read upload stream."), e.getMessage(), e);
        }
        return doUpload(projectId, folderUuid, fileName, suppliedMimeType, altText, caption, bytes, ctx);
    }

    @Override
    @Transactional
    public MediaWriteResult replace(UUID uuid, String fileName, String suppliedMimeType,
            byte[] bytes, RevisionContext ctx) {
        AssetVersionView current = require(ctx.projectId(), uuid);
        long projectId = assetRepository.findByProjectIdAndUuid(ctx.projectId(), uuid)
                .orElseThrow(() -> new SfException(ProblemFactory.notFound("Asset not found.")))
                .getProjectId();
        checkSize(bytes);
        String mimeType = sniff(bytes, fileName);
        requireAllowed(mimeType, effectiveAllowedMime(projectId));
        int orientation = readOrientation(bytes);
        BufferedImage image = decode(bytes, mimeType);
        checkDimensions(image);
        byte[] finalBytes = strip(bytes, image, mimeType);

        JsonNode old = current.payload();
        boolean wasProcessed = TextMediaTypes.isProcessed(old);
        boolean processCms = wasProcessed && TextMediaTypes.isText(mimeType);
        List<Diagnostic> warnings = processCms
                ? compileOrThrow(ctx.projectId(), TextMediaCompiler.decode(finalBytes).text(), mimeType)
                : List.of();

        String sha = sha256(finalBytes);
        storeBlob(sha, finalBytes, mimeType);

        String altText = JsonUtil.text(old, "altText").orElse(null);
        String caption = JsonUtil.text(old, "caption").orElse(null);
        String copyright = JsonUtil.text(old, "copyright").orElse(null);
        FocalPoint focalPoint = readFocalPoint(old);

        ObjectNode payload = buildPayload(sha, trimFileName(fileName), mimeType, finalBytes.length, image, orientation,
                altText, caption, copyright, focalPoint, generateVariants(finalBytes, image, mimeType), processCms);

        AssetVersionView updated = assetService.update(uuid,
                new UpdateAssetCommand(current.displayName(), payload), current.validFromRevision(), ctx);
        setMediaColumns(ctx.projectId(), uuid, mimeType, finalBytes.length);
        return new MediaWriteResult(updated, warnings, wasProcessed && !processCms);
    }

    @Override
    @Transactional
    public MediaWriteResult setProcessCms(UUID uuid, boolean processCms, long expectedRevision, RevisionContext ctx) {
        AssetVersionView current = require(ctx.projectId(), uuid);
        String mimeType = requireTextMime(current);
        List<Diagnostic> warnings = processCms
                ? compileOrThrow(ctx.projectId(), readText(current).text(), mimeType)
                : List.of();
        if (current.payload().path(TextMediaTypes.PROCESS_FLAG).asBoolean(false) == processCms) {
            assetService.requireRevision(ctx.projectId(), uuid, expectedRevision);
            return new MediaWriteResult(current, warnings, false);
        }
        ObjectNode payload = JsonUtil.object(current.payload()).deepCopy();
        payload.put(TextMediaTypes.PROCESS_FLAG, processCms);
        AssetVersionView updated = assetService.update(
                uuid, new UpdateAssetCommand(current.displayName(), payload), expectedRevision, ctx);
        return new MediaWriteResult(updated, warnings, false);
    }

    @Override
    @Transactional(readOnly = true)
    public MediaText readText(long projectId, UUID uuid, Long revision) {
        AssetVersionView view = requireAt(projectId, uuid, revision);
        String mimeType = requireTextMime(view);
        TextMediaCompiler.DecodedText decoded = readText(view);
        return new MediaText(decoded.text(), mimeType, view.validFromRevision(), decoded.utf8());
    }

    @Override
    @Transactional
    public MediaWriteResult writeText(UUID uuid, String text, long expectedRevision, RevisionContext ctx) {
        AssetVersionView current = require(ctx.projectId(), uuid);
        String mimeType = requireTextMime(current);
        byte[] bytes = (text == null ? "" : text).getBytes(StandardCharsets.UTF_8);
        checkSize(bytes);
        byte[] finalBytes = strip(bytes, null, mimeType);

        JsonNode old = current.payload();
        List<Diagnostic> warnings = TextMediaTypes.isProcessed(old)
                ? compileOrThrow(ctx.projectId(), new String(finalBytes, StandardCharsets.UTF_8), mimeType)
                : List.of();

        String sha = sha256(finalBytes);
        if (sha.equals(JsonUtil.text(old, "blobSha256").orElse(null))) {
            // Content-addressed: identical bytes are the version already stored, so no revision.
            assetService.requireRevision(ctx.projectId(), uuid, expectedRevision);
            return new MediaWriteResult(current, warnings, false);
        }
        storeBlob(sha, finalBytes, mimeType);

        ObjectNode payload = JsonUtil.object(old).deepCopy();
        payload.put("blobSha256", sha);
        payload.put("sizeBytes", finalBytes.length);
        AssetVersionView updated = assetService.update(
                uuid, new UpdateAssetCommand(current.displayName(), payload), expectedRevision, ctx);
        setMediaColumns(ctx.projectId(), uuid, mimeType, finalBytes.length);
        return new MediaWriteResult(updated, warnings, false);
    }

    @Override
    @Transactional(readOnly = true)
    public List<Diagnostic> validateText(long projectId, UUID uuid, String text) {
        String mimeType = requireTextMime(require(projectId, uuid));
        return textMediaCompiler.compile(projectId, text == null ? "" : text, mimeType).diagnostics();
    }

    /** The version's MIME type, or a {@code 400} when it is not text media. */
    private static String requireTextMime(AssetVersionView view) {
        String mimeType = JsonUtil.text(view.payload(), "mimeType").orElse(null);
        if (!TextMediaTypes.isText(mimeType)) {
            throw new SfException(ProblemFactory.badRequest(
                    "Only text media (CSS, JavaScript, JSON, SVG, XML, plain text) can be edited or processed;"
                            + " this file is '" + mimeType + "'."));
        }
        return mimeType;
    }

    private TextMediaCompiler.DecodedText readText(AssetVersionView view) {
        String sha = JsonUtil.text(view.payload(), "blobSha256")
                .orElseThrow(() -> new SfException(ProblemFactory.notFound("Media blob is missing.")));
        return TextMediaCompiler.decode(blobStore.get(sha));
    }

    /** Compiles processed source: errors are a {@code 422}, the (warning) diagnostics are returned. */
    private List<Diagnostic> compileOrThrow(long projectId, String source, String mimeType) {
        OctlResult result = textMediaCompiler.compile(projectId, source, mimeType);
        TextMediaCompiler.requireNoErrors(result);
        return result.diagnostics();
    }

    @Override
    @Transactional
    public AssetVersionView updateMetadata(UUID uuid, String altText, String caption, String copyright,
            FocalPoint focalPoint, long expectedRevision, RevisionContext ctx) {
        AssetVersionView current = require(ctx.projectId(), uuid);
        ObjectNode payload = JsonUtil.object(current.payload()).deepCopy();
        payload.put("altText", altText);
        payload.put("caption", caption);
        payload.put("copyright", copyright);
        FocalPoint fp = focalPoint == null ? FocalPoint.CENTER : focalPoint;
        ObjectNode fpNode = payload.has("focalPoint")
                ? (ObjectNode) payload.get("focalPoint")
                : payload.putObject("focalPoint");
        fpNode.put("x", fp.x());
        fpNode.put("y", fp.y());
        return assetService.update(uuid, new UpdateAssetCommand(current.displayName(), payload),
                expectedRevision, ctx);
    }

    @Override
    @Transactional(readOnly = true)
    public AssetVersionView require(long projectId, UUID uuid) {
        AssetVersionView view = assetService.requireCurrent(projectId, uuid);
        if (view.type() != AssetType.MEDIA) {
            throw new SfException(ProblemFactory.unprocessableEntity("Asset is not media."));
        }
        return view;
    }

    @Override
    @Transactional(readOnly = true)
    public Page<AssetVersionView> list(long projectId, String mimeType, String folder, boolean recursive, String q, Pageable pageable) {
        return mediaVersionRepository
                .searchMedia(projectId, mimePattern(mimeType), trimToNull(q), folderPattern(folder, recursive), pageable)
                .map(this::toView);
    }

    @Override
    @Transactional(readOnly = true)
    public MediaBinary binary(long projectId, UUID uuid, String variantName) {
        return binary(projectId, uuid, variantName, null);
    }

    @Override
    @Transactional(readOnly = true)
    public AssetVersionView requireAt(long projectId, UUID uuid, Long revision) {
        if (revision == null) {
            return require(projectId, uuid);
        }
        AssetVersionView view = assetService.findAt(projectId, uuid, revision)
                .orElseThrow(() -> new SfException(ProblemFactory.notFound("Media not found at revision " + revision + ".")));
        if (view.type() != AssetType.MEDIA) {
            throw new SfException(ProblemFactory.unprocessableEntity("Asset is not media."));
        }
        return view;
    }

    @Override
    @Transactional(readOnly = true)
    public MediaBinary binary(long projectId, UUID uuid, String variantName, Long revision) {
        AssetVersionView view = requireAt(projectId, uuid, revision);
        JsonNode payload = view.payload();
        String fileName = JsonUtil.text(payload, "fileName").orElse(view.displayName());

        if (variantName == null || variantName.isBlank()) {
            String sha = JsonUtil.text(payload, "blobSha256")
                    .orElseThrow(() -> new SfException(ProblemFactory.notFound("Media blob is missing.")));
            String mime = JsonUtil.text(payload, "mimeType").orElse("application/octet-stream");
            return new MediaBinary(mime, blobStore.get(sha), fileName);
        }

        JsonNode variants = payload.get("variants");
        if (variants != null && variants.isArray()) {
            for (JsonNode node : variants) {
                if (variantName.equals(node.path("name").asText())) {
                    String sha = node.path("blobSha256").asText();
                    String format = node.path("format").asText();
                    return new MediaBinary(formatMime(format), blobStore.get(sha), fileName);
                }
            }
        }
        throw new SfException(ProblemFactory.notFound("Variant '" + variantName + "' not found."));
    }

    @Override
    @Transactional(readOnly = true)
    public MediaBinary thumbnail(long projectId, UUID uuid) {
        AssetVersionView view = require(projectId, uuid);
        String mime = JsonUtil.text(view.payload(), "mimeType").orElse("");
        if (!isRasterImage(mime)) {
            throw new SfException(ProblemFactory.unprocessableEntity("Thumbnails require an image media asset."));
        }
        String sha = JsonUtil.text(view.payload(), "blobSha256")
                .orElseThrow(() -> new SfException(ProblemFactory.notFound("Media blob is missing.")));
        BufferedImage image = decode(blobStore.get(sha), mime);
        if (image == null) {
            throw new SfException(ProblemFactory.unprocessableEntity("Image could not be decoded."));
        }
        BufferedImage thumb = image.getWidth() > 320 ? resize(image, 320) : image;
        byte[] encoded;
        try {
            ByteArrayOutputStream bos = new ByteArrayOutputStream();
            ImageIO.write(thumb, "png", bos);
            encoded = bos.toByteArray();
        } catch (IOException e) {
            throw new SfException(
                    ProblemFactory.other(500, "SF-MEDIA-0504", "Storage Failure", "Failed to encode thumbnail."));
        }
        String fileName = JsonUtil.text(view.payload(), "fileName").orElse(view.displayName());
        return new MediaBinary("image/png", encoded, fileName);
    }

    private AssetVersionView doUpload(long projectId, UUID folderUuid, String fileName, String suppliedMimeType,
            String altText, String caption, byte[] bytes, RevisionContext ctx) {
        uploadBytesCounter.increment(bytes.length);
        checkSize(bytes);
        String mimeType = sniff(bytes, fileName);
        requireAllowed(mimeType, effectiveAllowedMime(projectId));
        int orientation = readOrientation(bytes);
        BufferedImage image = decode(bytes, mimeType);
        checkDimensions(image);
        byte[] finalBytes = strip(bytes, image, mimeType);
        String sha = sha256(finalBytes);
        storeBlob(sha, finalBytes, mimeType);

        ObjectNode payload = buildPayload(sha, trimFileName(fileName), mimeType, finalBytes.length, image, orientation,
                altText, caption, null, FocalPoint.CENTER, generateVariants(finalBytes, image, mimeType), false);

        AssetVersionView created = assetService.create(
                new CreateAssetCommand(projectId, AssetType.MEDIA, displayName(fileName), folderUuid, payload, null), ctx);
        setMediaColumns(projectId, created.uuid(), mimeType, finalBytes.length);
        return created;
    }

    private void checkSize(byte[] bytes) {
        if (bytes.length > properties.getMaxUploadSize().toBytes()) {
            throw new SfException(ProblemFactory.other(
                    413, "SF-MEDIA-0413", "Payload Too Large", "Upload exceeds the configured media size limit."));
        }
    }

    private void checkDimensions(BufferedImage image) {
        if (image != null
                && (image.getWidth() > properties.getMaxImageDimension()
                        || image.getHeight() > properties.getMaxImageDimension())) {
            throw new SfException(ProblemFactory.unprocessableEntity(
                    "Image exceeds the maximum dimension of " + properties.getMaxImageDimension() + "px."));
        }
    }

    private String sniff(byte[] bytes, String fileName) {
        String mime = tika.detect(bytes, fileName);
        return mime == null || mime.isBlank() ? "application/octet-stream" : mime;
    }

    private void requireAllowed(String mimeType, List<String> patterns) {
        if (!allowed(mimeType, patterns)) {
            throw new SfException(ProblemFactory.other(
                    415, "SF-MEDIA-0415", "Unsupported Media Type", "MIME type '" + mimeType + "' is not allowed."));
        }
    }

    /** The project's own MIME allow-list override if it has one, else the instance-wide {@code sf.media.allowed-mime} default. */
    private List<String> effectiveAllowedMime(long projectId) {
        List<String> projectOverride = projectRepository.findById(projectId)
                .map(Project::allowedMimeTypesList)
                .orElse(List.of());
        return projectOverride.isEmpty() ? properties.getAllowedMime() : projectOverride;
    }

    private static boolean allowed(String mimeType, List<String> patterns) {
        if (mimeType == null) {
            return false;
        }
        for (String pattern : patterns) {
            if (pattern.equals("*") || pattern.equals("*/*")) {
                return true;
            }
            if (pattern.endsWith("/*")) {
                if (mimeType.startsWith(pattern.substring(0, pattern.length() - 2))) {
                    return true;
                }
            } else if (pattern.equals(mimeType)) {
                return true;
            }
        }
        return false;
    }

    private byte[] strip(byte[] original, BufferedImage image, String mimeType) {
        if (!properties.isStripExif() || mimeType == null) {
            return original;
        }
        if ("image/jpeg".equals(mimeType) || "image/png".equals(mimeType)) {
            if (image == null) {
                return original;
            }
            try {
                ByteArrayOutputStream bos = new ByteArrayOutputStream();
                if ("image/jpeg".equals(mimeType)) {
                    writeJpeg(toRgb(image), bos, 90);
                } else {
                    ImageIO.write(image, "png", bos);
                }
                return bos.toByteArray();
            } catch (IOException e) {
                LOG.warn("EXIF strip re-encode failed, keeping original bytes: {}", e.getMessage());
                return original;
            }
        }
        if ("image/svg+xml".equals(mimeType)) {
            return svgSanitizer
                    .sanitize(new String(original, StandardCharsets.UTF_8))
                    .getBytes(StandardCharsets.UTF_8);
        }
        return original;
    }

    private List<ObjectNode> generateVariants(byte[] sourceBytes, BufferedImage image, String mimeType) {
        List<ObjectNode> variants = new ArrayList<>();
        if (image == null || !isRasterImage(mimeType)) {
            return variants;
        }
        for (MediaProperties.VariantDefinition def : properties.getVariants()) {
            if (def.width() == null || def.width() <= 0) {
                continue;
            }
            if ("webp".equalsIgnoreCase(def.format())) {
                LOG.info("Skipping webp variant '{}': no webp encoder available on this JVM.", def.name());
                continue;
            }
            String format = def.format() == null ? "jpeg" : def.format().toLowerCase(Locale.ROOT);
            byte[] variantBytes = encodeVariant(image, def.width(), format, def.quality());
            if (variantBytes == null) {
                continue;
            }
            String variantSha = sha256(variantBytes);
            storeBlob(variantSha, variantBytes, formatMime(format));
            ObjectNode entry = mapper.createObjectNode();
            entry.put("name", def.name());
            entry.put("blobSha256", variantSha);
            entry.put("width", def.width());
            entry.put("format", format);
            variants.add(entry);
        }
        return variants;
    }

    private byte[] encodeVariant(BufferedImage image, int width, String format, Integer quality) {
        BufferedImage scaled = resize(image, width);
        try {
            ByteArrayOutputStream bos = new ByteArrayOutputStream();
            if ("jpeg".equals(format) || "jpg".equals(format)) {
                writeJpeg(toRgb(scaled), bos, quality == null ? 82 : quality);
            } else {
                ImageIO.write(scaled, format, bos);
            }
            return bos.toByteArray();
        } catch (IOException e) {
            LOG.warn("Failed to encode variant ({}:{}): {}", format, width, e.getMessage());
            return null;
        }
    }

    private static void writeJpeg(BufferedImage image, java.io.OutputStream out, int quality) throws IOException {
        ImageWriter writer = ImageIO.getImageWritersByFormatName("jpeg").next();
        try (ImageOutputStream ios = ImageIO.createImageOutputStream(out)) {
            writer.setOutput(ios);
            ImageWriteParam param = writer.getDefaultWriteParam();
            param.setCompressionMode(ImageWriteParam.MODE_EXPLICIT);
            param.setCompressionQuality(quality / 100.0f);
            writer.write(null, new IIOImage(image, null, null), param);
        } finally {
            writer.dispose();
        }
    }

    private static BufferedImage toRgb(BufferedImage image) {
        if (image.getType() == BufferedImage.TYPE_INT_RGB) {
            return image;
        }
        BufferedImage rgb = new BufferedImage(image.getWidth(), image.getHeight(), BufferedImage.TYPE_INT_RGB);
        Graphics2D g = rgb.createGraphics();
        g.setColor(Color.WHITE);
        g.fillRect(0, 0, rgb.getWidth(), rgb.getHeight());
        g.drawImage(image, 0, 0, null);
        g.dispose();
        return rgb;
    }

    private static BufferedImage resize(BufferedImage src, int targetWidth) {
        int targetHeight = (int) Math.round(src.getHeight() * ((double) targetWidth / src.getWidth()));
        if (targetHeight < 1) {
            targetHeight = 1;
        }
        BufferedImage out = new BufferedImage(targetWidth, targetHeight, BufferedImage.TYPE_INT_ARGB);
        Graphics2D g = out.createGraphics();
        g.setRenderingHint(RenderingHints.KEY_INTERPOLATION, RenderingHints.VALUE_INTERPOLATION_BICUBIC);
        g.setRenderingHint(RenderingHints.KEY_RENDERING, RenderingHints.VALUE_RENDER_QUALITY);
        g.drawImage(src, 0, 0, targetWidth, targetHeight, null);
        g.dispose();
        return out;
    }

    private static BufferedImage decode(byte[] bytes, String mimeType) {
        if (!isRasterImage(mimeType)) {
            return null;
        }
        try {
            return ImageIO.read(new ByteArrayInputStream(bytes));
        } catch (IOException e) {
            return null;
        }
    }

    private static boolean isRasterImage(String mimeType) {
        return mimeType != null && mimeType.startsWith("image/") && !"image/svg+xml".equals(mimeType);
    }

    private static int readOrientation(byte[] bytes) {
        try {
            Metadata metadata = ImageMetadataReader.readMetadata(new ByteArrayInputStream(bytes));
            ExifIFD0Directory exif = metadata.getFirstDirectoryOfType(ExifIFD0Directory.class);
            if (exif != null && exif.containsTag(ExifIFD0Directory.TAG_ORIENTATION)) {
                return exif.getInt(ExifIFD0Directory.TAG_ORIENTATION);
            }
        } catch (Exception e) {
            LOG.debug("No EXIF orientation available: {}", e.getMessage());
        }
        return 1;
    }

    private static String dominantColor(BufferedImage image) {
        int stepX = Math.max(1, image.getWidth() / 32);
        int stepY = Math.max(1, image.getHeight() / 32);
        long r = 0;
        long g = 0;
        long b = 0;
        int n = 0;
        for (int y = 0; y < image.getHeight(); y += stepY) {
            for (int x = 0; x < image.getWidth(); x += stepX) {
                int argb = image.getRGB(x, y);
                r += (argb >> 16) & 0xff;
                g += (argb >> 8) & 0xff;
                b += argb & 0xff;
                n++;
            }
        }
        if (n == 0) {
            return null;
        }
        return String.format("#%02X%02X%02X", r / n, g / n, b / n);
    }

    private void storeBlob(String sha, byte[] bytes, String mimeType) {
        blobRepository.findById(sha).ifPresentOrElse(
                existing -> {
                    existing.setRefCount(existing.getRefCount() + 1);
                    blobRepository.save(existing);
                },
                () -> {
                    blobStore.put(sha, bytes);
                    blobRepository.save(new Blob(sha, bytes.length, mimeType, blobStore.storageKey(sha), 1, Instant.now()));
                });
    }

    private void setMediaColumns(long projectId, UUID uuid, String mimeType, long sizeBytes) {
        Asset asset = assetRepository.findByProjectIdAndUuid(projectId, uuid)
                .orElseThrow(() -> new SfException(ProblemFactory.notFound("Asset not found.")));
        mediaVersionRepository.findByAssetIdAndValidToRevisionIsNull(asset.getId()).ifPresent(version -> {
            version.setMimeType(mimeType);
            version.setSizeBytes(sizeBytes);
            mediaVersionRepository.save(version);
        });
    }

    private ObjectNode buildPayload(String sha, String fileName, String mimeType, long sizeBytes, BufferedImage image,
            int orientation, String altText, String caption, String copyright, FocalPoint focalPoint,
            List<ObjectNode> variants, boolean processCms) {
        ObjectNode root = mapper.createObjectNode();
        root.put("blobSha256", sha);
        root.put("fileName", fileName);
        root.put("mimeType", mimeType);
        root.put("sizeBytes", sizeBytes);
        if (image != null) {
            ObjectNode img = root.putObject("image");
            img.put("width", image.getWidth());
            img.put("height", image.getHeight());
            img.put("orientation", orientation);
            String color = dominantColor(image);
            if (color != null) {
                img.put("dominantColor", color);
            }
        }
        root.put("altText", altText);
        root.put("caption", caption);
        root.put("copyright", copyright);
        ObjectNode fp = root.putObject("focalPoint");
        fp.put("x", focalPoint == null ? 0.5 : focalPoint.x());
        fp.put("y", focalPoint == null ? 0.5 : focalPoint.y());
        ArrayNode arr = root.putArray("variants");
        variants.forEach(arr::add);
        root.put(TextMediaTypes.PROCESS_FLAG, processCms);
        return root;
    }

    private FocalPoint readFocalPoint(JsonNode payload) {
        JsonNode fp = payload == null ? null : payload.get("focalPoint");
        Double x = fp == null ? null : (fp.has("x") ? fp.get("x").asDouble() : null);
        Double y = fp == null ? null : (fp.has("y") ? fp.get("y").asDouble() : null);
        return FocalPoint.of(x, y);
    }

    private static String displayName(String fileName) {
        return trimFileName(fileName);
    }

    private static String trimFileName(String fileName) {
        if (fileName == null || fileName.isBlank()) {
            return "media";
        }
        String name = fileName.trim();
        int idx = Math.max(name.lastIndexOf('/'), name.lastIndexOf('\\'));
        if (idx >= 0) {
            name = name.substring(idx + 1);
        }
        if (name.isBlank()) {
            name = "media";
        }
        if (name.length() > 200) {
            name = name.substring(name.length() - 200);
        }
        return name;
    }

    private static String formatMime(String format) {
        if (format == null) {
            return "application/octet-stream";
        }
        return switch (format.toLowerCase(Locale.ROOT)) {
            case "jpeg", "jpg" -> "image/jpeg";
            case "png" -> "image/png";
            case "gif" -> "image/gif";
            case "webp" -> "image/webp";
            default -> "image/" + format.toLowerCase(Locale.ROOT);
        };
    }

    private static String mimePattern(String mimeType) {
        String trimmed = trimToNull(mimeType);
        if (trimmed == null) {
            return null;
        }
        if (trimmed.endsWith("/*")) {
            return escapeLike(trimmed.substring(0, trimmed.length() - 1)) + "%";
        }
        return escapeLike(trimmed) + "%";
    }

    private static String folderPattern(String folder, boolean recursive) {
        String trimmed = trimToNull(folder);
        if (trimmed == null) {
            return null;
        }
        return recursive ? escapeLike(trimmed) + "%" : escapeLike(trimmed);
    }

    private static String trimToNull(String value) {
        return (value == null || value.isBlank()) ? null : value.trim();
    }

    private static String escapeLike(String value) {
        return value.replace("!", "!!").replace("%", "!%").replace("_", "!_");
    }

    private AssetVersionView toView(AssetVersion version) {
        Asset asset = version.getAsset();
        return new AssetVersionView(
                asset.getUuid(),
                asset.getUid(),
                asset.getAssetType(),
                version.getDisplayName(),
                version.getPayload(),
                version.getValidFromRevision(),
                version.isDeleted(),
                version.getFolderId(),
                version.getFolderPath(),
                version.getTemplateAssetId(),
                version.getChangedBy(),
                version.getChangedAt());
    }

    private static String sha256(byte[] bytes) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] hash = digest.digest(bytes);
            StringBuilder sb = new StringBuilder(64);
            for (byte b : hash) {
                sb.append(String.format("%02x", b & 0xff));
            }
            return sb.toString();
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException("SHA-256 not available.", e);
        }
    }
}
