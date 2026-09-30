package com.acme.staticforge.asset.media;

import com.acme.staticforge.asset.Asset;
import com.acme.staticforge.asset.AssetVersion;
import com.acme.staticforge.asset.AssetRepository;
import com.acme.staticforge.asset.AssetService;
import com.acme.staticforge.asset.AssetType;
import com.acme.staticforge.asset.AssetVersionView;
import com.acme.staticforge.asset.CreateAssetCommand;
import com.acme.staticforge.asset.UpdateAssetCommand;
import com.acme.staticforge.common.JsonUtil;
import com.acme.staticforge.project.LocaleConfig;
import com.acme.staticforge.project.ProjectLocales;
import com.acme.staticforge.common.ProblemFactory;
import com.acme.staticforge.common.SfException;
import com.acme.staticforge.project.Project;
import com.acme.staticforge.project.ProjectRepository;
import com.acme.staticforge.release.ReleaseCarryForward;
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
import java.awt.image.BufferedImage;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import javax.imageio.ImageIO;
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
    private final BlobWriter blobWriter;
    private final MediaVariantGenerator variantGenerator;
    private final MediaVariantResolver variantResolver;
    private final BlobStore blobStore;
    private final MediaProperties properties;
    private final ProjectRepository projectRepository;
    private final TextMediaCompiler textMediaCompiler;
    private final SvgSanitizer svgSanitizer = new SvgSanitizer();
    private final ObjectMapper mapper = new ObjectMapper();
    private final Tika tika = new Tika();
    private final Counter uploadBytesCounter;

    private final ProjectLocales projectLocales;
    private final ReleaseCarryForward releaseCarryForward;

    public MediaServiceImpl(AssetService assetService, AssetRepository assetRepository,
            MediaVersionRepository mediaVersionRepository,
            BlobStore blobStore, MediaProperties properties, ProjectRepository projectRepository,
            TextMediaCompiler textMediaCompiler, MeterRegistry meterRegistry,
            ProjectLocales projectLocales, ReleaseCarryForward releaseCarryForward, BlobWriter blobWriter,
            MediaVariantGenerator variantGenerator, MediaVariantResolver variantResolver) {
        this.assetService = assetService;
        this.assetRepository = assetRepository;
        this.mediaVersionRepository = mediaVersionRepository;
        this.blobStore = blobStore;
        this.properties = properties;
        this.projectRepository = projectRepository;
        this.textMediaCompiler = textMediaCompiler;
        this.uploadBytesCounter = Counter.builder("sf.media.upload.bytes")
                .description("Bytes of media uploaded (spec §26.4).")
                .register(meterRegistry);
        this.projectLocales = projectLocales;
        this.releaseCarryForward = releaseCarryForward;
        this.blobWriter = blobWriter;
        this.variantGenerator = variantGenerator;
        this.variantResolver = variantResolver;
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
        return writeFile(require(ctx.projectId(), uuid), null, List.of(), fileName, bytes, ctx);
    }

    @Override
    @Transactional
    public AssetVersionView setLocalized(
            UUID uuid, boolean localized, boolean confirmDiscard, long expectedRevision, RevisionContext ctx) {
        AssetVersionView current = require(ctx.projectId(), uuid);
        LocaleConfig locales = projectLocales.forProject(ctx.projectId());
        if (!locales.isLocalized()) {
            throw MediaProblems.projectHasNoLocales();
        }
        assetService.requireRevision(ctx.projectId(), uuid, expectedRevision);
        JsonNode old = current.payload();
        if (MediaFiles.isLocalized(old) == localized) {
            return current;
        }
        ObjectNode payload = JsonUtil.object(old).deepCopy();
        if (localized) {
            // The existing file becomes the default locale's; every other locale falls back to it.
            payload.put(MediaFiles.LOCALIZED, true);
            payload.put(MediaFiles.FILE_LOCALE, locales.defaultLocale());
            payload.remove(MediaFiles.LOCALE_FILES);
        } else {
            List<String> chain = locales.effectiveChain(locales.defaultLocale());
            MediaFiles.Resolved kept = MediaFiles.fileFor(old, locales.defaultLocale(), chain);
            List<Map<String, Object>> discarded = discardedFiles(old, kept, chain);
            if (!discarded.isEmpty() && !confirmDiscard) {
                throw MediaProblems.localeFilesWouldBeDiscarded(discarded);
            }
            MediaFiles.setFile(payload, kept.file());
            payload.remove(MediaFiles.LOCALIZED);
            payload.remove(MediaFiles.FILE_LOCALE);
            payload.remove(MediaFiles.LOCALE_FILES);
        }
        Asset asset = assetRepository.findByProjectIdAndUuid(ctx.projectId(), uuid)
                .orElseThrow(() -> new SfException(ProblemFactory.notFound("Asset not found.")));
        long previousVersionId = openVersion(asset).getId();
        AssetVersionView updated = assetService.update(
                uuid, new UpdateAssetCommand(current.displayName(), payload), expectedRevision, ctx);
        releaseCarryForward.rekeyMedia(
                ctx.projectId(),
                new ReleaseCarryForward.Rewrite(asset.getId(), previousVersionId, openVersion(asset).getId()),
                localized,
                updated.validFromRevision());
        return updated;
    }

    @Override
    @Transactional
    public MediaWriteResult putLocaleFile(
            UUID uuid, String locale, String fileName, String suppliedMimeType, byte[] bytes, RevisionContext ctx) {
        AssetVersionView current = require(ctx.projectId(), uuid);
        LocaleConfig locales = projectLocales.forProject(ctx.projectId());
        String target = localeFileTarget(current.payload(), locales, locale);
        return writeFile(current, target, locales.effectiveChain(target), fileName, bytes, ctx);
    }

    @Override
    @Transactional
    public AssetVersionView removeLocaleFile(UUID uuid, String locale, RevisionContext ctx) {
        AssetVersionView current = require(ctx.projectId(), uuid);
        LocaleConfig locales = projectLocales.forProject(ctx.projectId());
        JsonNode old = current.payload();
        String target = localeFileTarget(old, locales, locale);
        if (target.equals(MediaFiles.topLocale(old, locales.effectiveChain(target)))) {
            throw MediaProblems.defaultFileRequired(target);
        }
        if (!MediaFiles.localeFileKeys(old).contains(target)) {
            return current;
        }
        ObjectNode payload = JsonUtil.object(old).deepCopy();
        ((ObjectNode) payload.get(MediaFiles.LOCALE_FILES)).remove(target);
        return assetService.update(
                uuid, new UpdateAssetCommand(current.displayName(), payload), current.validFromRevision(), ctx);
    }

    /** The declared spelling of {@code locale} for a per-locale file operation on localized media, or the refusal. */
    private static String localeFileTarget(JsonNode payload, LocaleConfig locales, String locale) {
        if (!MediaFiles.isLocalized(payload)) {
            throw MediaProblems.notLocalized();
        }
        String declared = locales.canonicalDeclared(locale);
        if (declared == null) {
            throw MediaProblems.unknownLocale(locale);
        }
        return declared;
    }

    /** The files un-localizing would drop: every own file but the one the default locale keeps. */
    private static List<Map<String, Object>> discardedFiles(
            JsonNode payload, MediaFiles.Resolved kept, List<String> chain) {
        List<Map<String, Object>> files = new ArrayList<>();
        String top = MediaFiles.topLocale(payload, chain);
        if (top != null && !top.equals(kept.locale())) {
            files.add(fileSummary(top, MediaFiles.topFile(payload)));
        }
        for (String locale : MediaFiles.localeFileKeys(payload)) {
            if (!locale.equals(kept.locale())) {
                files.add(fileSummary(locale, payload.path(MediaFiles.LOCALE_FILES).get(locale)));
            }
        }
        return files;
    }

    private static Map<String, Object> fileSummary(String locale, JsonNode file) {
        Map<String, Object> summary = new LinkedHashMap<>();
        summary.put("locale", locale);
        summary.put("fileName", file.path("fileName").asText(null));
        summary.put("sizeBytes", file.path("sizeBytes").asLong(0));
        return summary;
    }

    private AssetVersion openVersion(Asset asset) {
        return mediaVersionRepository.findByAssetIdAndValidToRevisionIsNull(asset.getId())
                .orElseThrow(() -> new SfException(ProblemFactory.notFound("Media has no current version.")));
    }

    /**
     * Runs {@code bytes} through the upload pipeline and stores them, in one revision, as {@code locale}'s own file
     * of localized media — {@code null} for the top-level (default) file. A processed file stays processed when the
     * new file is text too (its source is compiled, errors are a {@code 422}); otherwise {@code processCms} is
     * switched off and the result says so.
     */
    private MediaWriteResult writeFile(AssetVersionView current, String locale, List<String> chain, String fileName,
            byte[] bytes, RevisionContext ctx) {
        Prepared prepared = prepare(ctx.projectId(), fileName, bytes);
        JsonNode old = current.payload();
        JsonNode before = locale == null ? old : MediaFiles.fileFor(old, locale, chain).file();
        boolean wasProcessed = TextMediaTypes.isProcessed(before);
        boolean processCms = wasProcessed && TextMediaTypes.isText(prepared.mimeType());
        List<Diagnostic> warnings = processCms
                ? compileOrThrow(ctx.projectId(), TextMediaCompiler.decode(prepared.bytes()).text(), prepared.mimeType())
                : List.of();

        ObjectNode file = store(prepared, processCms);
        // Copy the payload, so metadata (alt text in every language, caption, copyright, focal point) and the other
        // locales' files stay as they are.
        ObjectNode payload = JsonUtil.object(old).deepCopy();
        if (locale == null) {
            MediaFiles.setFile(payload, file);
        } else {
            MediaFiles.putOwnFile(payload, locale, MediaFiles.topLocale(old, chain), file);
        }
        AssetVersionView updated = assetService.update(current.uuid(),
                new UpdateAssetCommand(current.displayName(), payload), current.validFromRevision(), ctx);
        return new MediaWriteResult(updated, warnings, wasProcessed && !processCms);
    }

    @Override
    @Transactional
    public MediaWriteResult setProcessCms(UUID uuid, boolean processCms, long expectedRevision, RevisionContext ctx) {
        return doSetProcessCms(uuid, processCms, null, expectedRevision, ctx);
    }

    @Override
    @Transactional
    public MediaWriteResult setProcessCms(
            UUID uuid, boolean processCms, String locale, long expectedRevision, RevisionContext ctx) {
        return doSetProcessCms(uuid, processCms, locale, expectedRevision, ctx);
    }

    private MediaWriteResult doSetProcessCms(
            UUID uuid, boolean processCms, String locale, long expectedRevision, RevisionContext ctx) {
        AssetVersionView current = require(ctx.projectId(), uuid);
        FileRef ref = fileRef(ctx.projectId(), current.payload(), locale);
        String mimeType = requireTextMime(ref.file());
        List<Diagnostic> warnings = processCms
                ? compileOrThrow(ctx.projectId(), readText(ref.file()).text(), mimeType)
                : List.of();
        if (ref.file().path(TextMediaTypes.PROCESS_FLAG).asBoolean(false) == processCms) {
            assetService.requireRevision(ctx.projectId(), uuid, expectedRevision);
            return new MediaWriteResult(current, warnings, false);
        }
        ObjectNode payload = JsonUtil.object(current.payload()).deepCopy();
        ref.write(payload, file -> file.put(TextMediaTypes.PROCESS_FLAG, processCms));
        AssetVersionView updated = assetService.update(
                uuid, new UpdateAssetCommand(current.displayName(), payload), expectedRevision, ctx);
        return new MediaWriteResult(updated, warnings, false);
    }

    @Override
    @Transactional(readOnly = true)
    public MediaText readText(long projectId, UUID uuid, Long revision) {
        return readText(projectId, uuid, revision, null);
    }

    @Override
    @Transactional(readOnly = true)
    public MediaText readText(long projectId, UUID uuid, Long revision, String locale) {
        AssetVersionView view = requireAt(projectId, uuid, revision);
        JsonNode file = effectivePayload(projectId, view.payload(), locale);
        String mimeType = requireTextMime(file);
        TextMediaCompiler.DecodedText decoded = readText(file);
        return new MediaText(decoded.text(), mimeType, view.validFromRevision(), decoded.utf8());
    }

    @Override
    @Transactional
    public MediaWriteResult writeText(UUID uuid, String text, long expectedRevision, RevisionContext ctx) {
        return doWriteText(uuid, text, null, expectedRevision, ctx);
    }

    @Override
    @Transactional
    public MediaWriteResult writeText(UUID uuid, String text, String locale, long expectedRevision, RevisionContext ctx) {
        return doWriteText(uuid, text, locale, expectedRevision, ctx);
    }

    private MediaWriteResult doWriteText(
            UUID uuid, String text, String locale, long expectedRevision, RevisionContext ctx) {
        AssetVersionView current = require(ctx.projectId(), uuid);
        JsonNode old = current.payload();
        // A locale writes its own file; one that falls back gets a copy of the file it rendered (M27.3.1).
        String target = null;
        List<String> chain = List.of();
        if (locale != null && MediaFiles.isLocalized(old)) {
            LocaleConfig locales = projectLocales.forProject(ctx.projectId());
            target = localeFileTarget(old, locales, locale);
            chain = locales.effectiveChain(target);
        }
        JsonNode file = target == null ? old : MediaFiles.fileFor(old, target, chain).file();
        String mimeType = requireTextMime(file);
        byte[] bytes = (text == null ? "" : text).getBytes(StandardCharsets.UTF_8);
        checkSize(bytes);
        byte[] finalBytes = strip(bytes, null, mimeType);

        List<Diagnostic> warnings = TextMediaTypes.isProcessed(file)
                ? compileOrThrow(ctx.projectId(), new String(finalBytes, StandardCharsets.UTF_8), mimeType)
                : List.of();

        String sha = sha256(finalBytes);
        if (sha.equals(JsonUtil.text(file, "blobSha256").orElse(null))) {
            // Content-addressed: identical bytes are the version already stored, so no revision.
            assetService.requireRevision(ctx.projectId(), uuid, expectedRevision);
            return new MediaWriteResult(current, warnings, false);
        }
        storeBlob(sha, finalBytes, mimeType);

        ObjectNode payload = JsonUtil.object(old).deepCopy();
        if (target == null) {
            payload.put("blobSha256", sha);
            payload.put("sizeBytes", finalBytes.length);
        } else {
            ObjectNode own = JsonUtil.object(file).deepCopy();
            own.put("blobSha256", sha);
            own.put("sizeBytes", finalBytes.length);
            MediaFiles.putOwnFile(payload, target, MediaFiles.topLocale(old, chain), own);
        }
        AssetVersionView updated = assetService.update(
                uuid, new UpdateAssetCommand(current.displayName(), payload), expectedRevision, ctx);
        return new MediaWriteResult(updated, warnings, false);
    }

    @Override
    @Transactional(readOnly = true)
    public List<Diagnostic> validateText(long projectId, UUID uuid, String text) {
        String mimeType = requireTextMime(require(projectId, uuid).payload());
        return textMediaCompiler.compile(projectId, text == null ? "" : text, mimeType).diagnostics();
    }

    /** The file's MIME type, or a {@code 400} when it is not text media. */
    private static String requireTextMime(JsonNode file) {
        String mimeType = JsonUtil.text(file, "mimeType").orElse(null);
        if (!TextMediaTypes.isText(mimeType)) {
            throw new SfException(ProblemFactory.badRequest(
                    "Only text media (CSS, JavaScript, JSON, SVG, XML, plain text) can be edited or processed;"
                            + " this file is '" + mimeType + "'."));
        }
        return mimeType;
    }

    private TextMediaCompiler.DecodedText readText(JsonNode file) {
        String sha = JsonUtil.text(file, "blobSha256")
                .orElseThrow(() -> new SfException(ProblemFactory.notFound("Media blob is missing.")));
        return TextMediaCompiler.decode(blobStore.get(sha));
    }

    /**
     * {@code payload} as {@code locale} renders it (M27.3.1): localized media's top-level file fields replaced by the
     * locale's file. {@code null} and media that isn't localized give {@code payload} itself.
     */
    private JsonNode effectivePayload(long projectId, JsonNode payload, String locale) {
        if (locale == null || !MediaFiles.isLocalized(payload)) {
            return payload;
        }
        return MediaFiles.effective(payload, locale, projectLocales.forProject(projectId).effectiveChain(locale));
    }

    /**
     * The file a write for {@code locale} addresses: the file it renders and the locale that owns it ({@code null}:
     * the top-level file, also for media that isn't localized).
     */
    private FileRef fileRef(long projectId, JsonNode payload, String locale) {
        if (locale == null || !MediaFiles.isLocalized(payload)) {
            return new FileRef(payload, null, null);
        }
        LocaleConfig locales = projectLocales.forProject(projectId);
        String declared = localeFileTarget(payload, locales, locale);
        List<String> chain = locales.effectiveChain(declared);
        MediaFiles.Resolved resolved = MediaFiles.fileFor(payload, declared, chain);
        return new FileRef(resolved.file(), resolved.locale(), MediaFiles.topLocale(payload, chain));
    }

    /** One file of a media payload and where it is stored ({@code owner == null}: the top-level fields). */
    private record FileRef(JsonNode file, String owner, String top) {

        void write(ObjectNode payload, java.util.function.Consumer<ObjectNode> change) {
            if (owner == null || owner.equals(top)) {
                change.accept(payload);
                return;
            }
            ObjectNode own = JsonUtil.object(file).deepCopy();
            change.accept(own);
            MediaFiles.putOwnFile(payload, owner, top, own);
        }
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
            FocalPoint focalPoint, String locale, long expectedRevision, RevisionContext ctx) {
        AssetVersionView current = require(ctx.projectId(), uuid);
        ObjectNode payload = JsonUtil.object(current.payload()).deepCopy();
        // `altText` and `caption` are localizable in a project with locales (M24.2.2): the write
        // targets one language and leaves the others alone. `copyright` stays single-valued.
        LocaleConfig locales = projectLocales.forProject(ctx.projectId());
        if (locales.isLocalized()) {
            String target = locales.canonicalDeclared(locale) != null
                    ? locales.canonicalDeclared(locale)
                    : locales.defaultLocale();
            setLocalized(payload, "altText", target, locales.defaultLocale(), altText);
            setLocalized(payload, "caption", target, locales.defaultLocale(), caption);
        } else {
            payload.put("altText", altText);
            payload.put("caption", caption);
        }
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
        return binary(projectId, uuid, variantName, revision, null);
    }

    @Override
    @Transactional(readOnly = true)
    public MediaBinary binary(long projectId, UUID uuid, String variantName, Long revision, String locale) {
        AssetVersionView view = requireAt(projectId, uuid, revision);
        JsonNode payload = effectivePayload(projectId, view.payload(), locale);
        String fileName = JsonUtil.text(payload, "fileName").orElse(view.displayName());

        if (variantName == null || variantName.isBlank()) {
            String sha = JsonUtil.text(payload, "blobSha256")
                    .orElseThrow(() -> new SfException(ProblemFactory.notFound("Media blob is missing.")));
            String mime = JsonUtil.text(payload, "mimeType").orElse("application/octet-stream");
            return new MediaBinary(mime, blobStore.get(sha), fileName);
        }

        // Payload variants and the derived ones of media_variant (M29.3.2), the payload winning on a name.
        for (JsonNode node : variantResolver.variantsFor(payload)) {
            if (variantName.equals(node.path("name").asText())) {
                String sha = node.path("blobSha256").asText();
                String format = node.path("format").asText();
                return new MediaBinary(formatMime(format), blobStore.get(sha), fileName);
            }
        }
        throw new SfException(ProblemFactory.notFound("Variant '" + variantName + "' not found."));
    }

    @Override
    @Transactional(readOnly = true)
    public MediaBinary thumbnail(long projectId, UUID uuid) {
        return thumbnail(projectId, uuid, null);
    }

    @Override
    @Transactional(readOnly = true)
    public MediaBinary thumbnail(long projectId, UUID uuid, String locale) {
        AssetVersionView view = require(projectId, uuid);
        JsonNode payload = effectivePayload(projectId, view.payload(), locale);
        String mime = JsonUtil.text(payload, "mimeType").orElse("");
        if (!MediaVariantGenerator.isRasterImage(mime)) {
            throw new SfException(ProblemFactory.unprocessableEntity("Thumbnails require an image media asset."));
        }
        String sha = JsonUtil.text(payload, "blobSha256")
                .orElseThrow(() -> new SfException(ProblemFactory.notFound("Media blob is missing.")));
        BufferedImage image = MediaVariantGenerator.decode(blobStore.get(sha), mime);
        if (image == null) {
            throw new SfException(ProblemFactory.unprocessableEntity("Image could not be decoded."));
        }
        BufferedImage thumb = image.getWidth() > 320 ? MediaVariantGenerator.resize(image, 320) : image;
        byte[] encoded;
        try {
            ByteArrayOutputStream bos = new ByteArrayOutputStream();
            ImageIO.write(thumb, "png", bos);
            encoded = bos.toByteArray();
        } catch (IOException e) {
            throw new SfException(
                    ProblemFactory.other(500, "SF-MEDIA-0504", "Storage Failure", "Failed to encode thumbnail."));
        }
        String fileName = JsonUtil.text(payload, "fileName").orElse(view.displayName());
        return new MediaBinary("image/png", encoded, fileName);
    }

    private AssetVersionView doUpload(long projectId, UUID folderUuid, String fileName, String suppliedMimeType,
            String altText, String caption, byte[] bytes, RevisionContext ctx) {
        uploadBytesCounter.increment(bytes.length);
        ObjectNode file = store(prepare(projectId, fileName, bytes), false);
        // The payload's field order is the one media has always been stored with: file, metadata, variants, flag.
        ObjectNode payload = mapper.createObjectNode();
        for (String field : List.of("blobSha256", "fileName", "mimeType", "sizeBytes", "image")) {
            if (file.has(field)) {
                payload.set(field, file.get(field));
            }
        }
        payload.put("altText", altText);
        payload.put("caption", caption);
        payload.putNull("copyright");
        ObjectNode fp = payload.putObject("focalPoint");
        fp.put("x", FocalPoint.CENTER.x());
        fp.put("y", FocalPoint.CENTER.y());
        payload.set("variants", file.get("variants"));
        payload.set(TextMediaTypes.PROCESS_FLAG, file.get(TextMediaTypes.PROCESS_FLAG));
        return assetService.create(
                new CreateAssetCommand(projectId, AssetType.MEDIA, displayName(fileName), folderUuid, payload, null), ctx);
    }

    /** An upload run through the pipeline (checked, sniffed, stripped), not stored yet. */
    private record Prepared(String fileName, String mimeType, byte[] bytes, BufferedImage image, int orientation) {}

    /**
     * The upload pipeline up to storage (spec §11.4): size cap, Tika MIME sniffing against the allow-list, EXIF
     * orientation, decode and dimension cap, EXIF strip / SVG sanitizing.
     */
    private Prepared prepare(long projectId, String fileName, byte[] bytes) {
        checkSize(bytes);
        String mimeType = sniff(bytes, fileName);
        requireAllowed(mimeType, effectiveAllowedMime(projectId));
        int orientation = readOrientation(bytes);
        BufferedImage image = MediaVariantGenerator.decode(bytes, mimeType);
        checkDimensions(image);
        return new Prepared(trimFileName(fileName), mimeType, strip(bytes, image, mimeType), image, orientation);
    }

    /** Stores a prepared upload's blob and its variants; returns the file fields of a media payload. */
    private ObjectNode store(Prepared prepared, boolean processCms) {
        String sha = sha256(prepared.bytes());
        storeBlob(sha, prepared.bytes(), prepared.mimeType());
        ObjectNode file = mapper.createObjectNode();
        file.put("blobSha256", sha);
        file.put("fileName", prepared.fileName());
        file.put("mimeType", prepared.mimeType());
        file.put("sizeBytes", prepared.bytes().length);
        BufferedImage image = prepared.image();
        if (image != null) {
            ObjectNode img = file.putObject("image");
            img.put("width", image.getWidth());
            img.put("height", image.getHeight());
            img.put("orientation", prepared.orientation());
            String color = dominantColor(image);
            if (color != null) {
                img.put("dominantColor", color);
            }
        }
        ArrayNode variants = file.putArray("variants");
        generateVariants(sha, image, prepared.mimeType()).forEach(variants::add);
        file.put(TextMediaTypes.PROCESS_FLAG, processCms);
        return file;
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
                    MediaVariantGenerator.writeJpeg(MediaVariantGenerator.toRgb(image), bos, 90);
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

    /**
     * The policy's variants of an uploaded raster image, stored and recorded in {@code media_variant} (M29.3.2) as well
     * as returned for the payload. A definition this JVM can't encode ({@code webp}) or a failed encode is skipped; the
     * {@code media-variant-backfill} job reports and retries both.
     */
    private List<ObjectNode> generateVariants(String sourceSha, BufferedImage image, String mimeType) {
        List<ObjectNode> variants = new ArrayList<>();
        if (image == null || !MediaVariantGenerator.isRasterImage(mimeType)) {
            return variants;
        }
        for (MediaVariantSpec spec : MediaVariantSpec.policy(properties)) {
            if (!spec.supported()) {
                LOG.info("Skipping {} variant '{}': no {} encoder available on this JVM.", spec.format(), spec.name(),
                        spec.format());
                continue;
            }
            try {
                variants.add(variantGenerator.generate(sourceSha, image, spec));
            } catch (MediaVariantGenerator.EncodingException e) {
                LOG.warn("Failed to encode variant ({}:{}): {}", spec.format(), spec.width(), e.getMessage());
            }
        }
        return variants;
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
        blobWriter.store(sha, bytes, mimeType);
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

    /**
     * Writes one language's value of a localizable media metadata field, wrapping a value stored
     * before the project had locales as the default language's translation (M24.2.2).
     */
    private void setLocalized(ObjectNode payload, String field, String locale, String defaultLocale, String value) {
        com.fasterxml.jackson.databind.JsonNode current = payload.get(field);
        com.fasterxml.jackson.databind.JsonNode wrapper = com.acme.staticforge.common.L10nValues.isL10n(current)
                ? current
                : com.acme.staticforge.common.L10nValues.wrap(current, defaultLocale);
        payload.set(field, com.acme.staticforge.common.L10nValues.with(
                wrapper,
                locale,
                value == null || value.isBlank()
                        ? null
                        : com.fasterxml.jackson.databind.node.JsonNodeFactory.instance.textNode(value)));
    }
}
