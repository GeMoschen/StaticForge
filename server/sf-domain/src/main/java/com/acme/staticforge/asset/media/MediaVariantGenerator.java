package com.acme.staticforge.asset.media;

import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.awt.Color;
import java.awt.Graphics2D;
import java.awt.RenderingHints;
import java.awt.image.BufferedImage;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.OutputStream;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Clock;
import java.util.HexFormat;
import javax.imageio.IIOImage;
import javax.imageio.ImageIO;
import javax.imageio.ImageWriteParam;
import javax.imageio.ImageWriter;
import javax.imageio.stream.ImageOutputStream;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

/**
 * Encodes one media variant (spec §11.4) and records it (M29.3.2): the bytes go to the blob store through
 * {@link BlobWriter}, the definition to {@code media_variant}. Used by uploads (which also keep writing the variant into
 * the version payload) and by the {@code media-variant-backfill} job (which writes only the table row).
 */
@Component
public class MediaVariantGenerator {

    private final BlobWriter blobWriter;
    private final MediaVariantRepository variants;
    private final Clock clock;

    public MediaVariantGenerator(BlobWriter blobWriter, MediaVariantRepository variants, Clock clock) {
        this.blobWriter = blobWriter;
        this.variants = variants;
        this.clock = clock;
    }

    /** A variant could not be encoded (an encoder error or an empty result). */
    public static class EncodingException extends Exception {
        public EncodingException(String message, Throwable cause) {
            super(message, cause);
        }
    }

    /** Whether variants apply to {@code mimeType}: raster images (SVG is scalable and gets none). */
    public static boolean isRasterImage(String mimeType) {
        return mimeType != null && mimeType.startsWith("image/") && !"image/svg+xml".equals(mimeType);
    }

    /** {@code bytes} decoded as a raster image; {@code null} when they aren't one or can't be decoded. */
    public static BufferedImage decode(byte[] bytes, String mimeType) {
        if (!isRasterImage(mimeType) || bytes == null) {
            return null;
        }
        try {
            return ImageIO.read(new ByteArrayInputStream(bytes));
        } catch (IOException | RuntimeException e) {
            return null;
        }
    }

    /**
     * Encodes {@code spec} from {@code image} (the decoded bytes of blob {@code sourceSha}), stores the variant's blob
     * and records its {@code media_variant} row (idempotent), in the caller's transaction. Returns the payload entry
     * ({@code name}, {@code blobSha256}, {@code width}, {@code format}).
     */
    @Transactional(propagation = Propagation.MANDATORY)
    public ObjectNode generate(String sourceSha, BufferedImage image, MediaVariantSpec spec) throws EncodingException {
        byte[] bytes = encode(image, spec);
        String sha = sha256(bytes);
        blobWriter.store(sha, bytes, spec.mimeType());
        variants.insertIfAbsent(sourceSha, spec, sha, clock.instant());
        return entry(spec, sha);
    }

    /** The payload shape of a variant. */
    public static ObjectNode entry(MediaVariantSpec spec, String blobSha) {
        ObjectNode entry = JsonNodeFactory.instance.objectNode();
        entry.put("name", spec.name());
        entry.put("blobSha256", blobSha);
        entry.put("width", spec.width());
        entry.put("format", spec.format());
        return entry;
    }

    static byte[] encode(BufferedImage image, MediaVariantSpec spec) throws EncodingException {
        try {
            BufferedImage scaled = resize(image, spec.width());
            ByteArrayOutputStream bos = new ByteArrayOutputStream();
            if (MediaVariantSpec.isJpeg(spec.format())) {
                writeJpeg(toRgb(scaled), bos, spec.quality());
            } else if (!ImageIO.write(scaled, spec.format(), bos)) {
                throw new EncodingException("No " + spec.format() + " encoder", null);
            }
            if (bos.size() == 0) {
                throw new EncodingException("The encoder produced no bytes", null);
            }
            return bos.toByteArray();
        } catch (IOException | RuntimeException e) {
            throw new EncodingException(e.getMessage() == null ? e.getClass().getSimpleName() : e.getMessage(), e);
        }
    }

    static void writeJpeg(BufferedImage image, OutputStream out, int quality) throws IOException {
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

    static BufferedImage toRgb(BufferedImage image) {
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

    static BufferedImage resize(BufferedImage src, int targetWidth) {
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

    static String sha256(byte[] bytes) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes));
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException("SHA-256 not available.", e);
        }
    }
}
