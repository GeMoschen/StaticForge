package com.acme.staticforge.asset.media;

import java.util.Locale;

/**
 * Canonical output paths for media assets copied into a build (spec §18.2 ASSETS, §11.1).
 * The renderer's {@code $CMS_REF(media:...)} URL resolver and the ASSETS copy stage MUST
 * agree on these exact paths, so both share this single helper.
 *
 * <p>Primary binary: {@code assets/media/{uid}.{ext}}. Variant {@code V}:
 * {@code assets/media/{uid}-{V}.{ext}} (the extension follows the variant's format).
 */
public final class MediaPaths {

    private MediaPaths() {}

    public static String mediaPath(String uid, String ext) {
        return "assets/media/" + uid + "." + ext;
    }

    public static String variantPath(String uid, String variantName, String ext) {
        return "assets/media/" + uid + "-" + variantName + "." + ext;
    }

    /** File extension for a MIME type, used to name media copies deterministically. */
    public static String extensionFor(String mimeType) {
        if (mimeType == null) {
            return "bin";
        }
        String m = mimeType.toLowerCase(Locale.ROOT);
        return switch (m) {
            case "image/jpeg", "image/jpg" -> "jpg";
            case "image/png" -> "png";
            case "image/webp" -> "webp";
            case "image/gif" -> "gif";
            case "image/svg+xml" -> "svg";
            case "image/avif" -> "avif";
            case "video/mp4" -> "mp4";
            case "video/webm" -> "webm";
            case "audio/mpeg" -> "mp3";
            case "audio/ogg" -> "ogg";
            case "application/pdf" -> "pdf";
            case "text/css" -> "css";
            case "application/javascript", "text/javascript" -> "js";
            case "font/ttf" -> "ttf";
            case "font/otf" -> "otf";
            case "font/woff" -> "woff";
            case "font/woff2" -> "woff2";
            case "text/plain" -> "txt";
            case "application/json" -> "json";
            case "application/manifest+json" -> "webmanifest";
            case "application/xml", "text/xml" -> "xml";
            default -> "bin";
        };
    }
}
