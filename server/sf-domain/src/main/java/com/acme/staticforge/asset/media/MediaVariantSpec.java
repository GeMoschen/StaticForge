package com.acme.staticforge.asset.media;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import javax.imageio.ImageIO;

/**
 * One variant definition of the policy ({@code sf.media.variants}, spec §11.4), normalized to what the encoder does
 * (M29.3.2): the format lower-cased ({@code jpeg} when unset) and the effective quality (JPEG: the definition's or
 * {@value #DEFAULT_JPEG_QUALITY}; {@code 0} for formats without a quality). {@code (name, width, format, quality)} is
 * the key of a {@code media_variant} row, so a changed width or quality under the same name is a different variant.
 */
public record MediaVariantSpec(String name, int width, String format, int quality) {

    /** The JPEG quality when a definition names none. */
    public static final int DEFAULT_JPEG_QUALITY = 82;

    /** The normalized form of {@code def}; {@code null} for a definition without a positive width or a name. */
    public static MediaVariantSpec of(MediaProperties.VariantDefinition def) {
        if (def == null || def.name() == null || def.name().isBlank() || def.width() == null || def.width() <= 0) {
            return null;
        }
        String format = def.format() == null || def.format().isBlank() ? "jpeg" : def.format().toLowerCase(Locale.ROOT);
        int quality = isJpeg(format) ? (def.quality() == null ? DEFAULT_JPEG_QUALITY : def.quality()) : 0;
        return new MediaVariantSpec(def.name(), def.width(), format, quality);
    }

    /** The current policy's usable definitions, in declaration order. */
    public static List<MediaVariantSpec> policy(MediaProperties properties) {
        List<MediaVariantSpec> out = new ArrayList<>();
        for (MediaProperties.VariantDefinition def : properties.getVariants()) {
            MediaVariantSpec spec = of(def);
            if (spec != null) {
                out.add(spec);
            }
        }
        return out;
    }

    /** Whether this JVM can encode the format ({@code webp} can't without a plugin). */
    public boolean supported() {
        return ImageIO.getImageWritersByFormatName(isJpeg(format) ? "jpeg" : format).hasNext();
    }

    /** The MIME type of the encoded variant. */
    public String mimeType() {
        return switch (format) {
            case "jpeg", "jpg" -> "image/jpeg";
            default -> "image/" + format;
        };
    }

    /** {@code "name:width:format:quality"}, for reports. */
    public String label() {
        return name + ":" + width + ":" + format + (quality > 0 ? ":" + quality : "");
    }

    static boolean isJpeg(String format) {
        return "jpeg".equals(format) || "jpg".equals(format);
    }
}
