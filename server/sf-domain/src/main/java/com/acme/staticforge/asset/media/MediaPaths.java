package com.acme.staticforge.asset.media;

import com.acme.staticforge.project.LocaleConfig;
import java.util.Locale;

/**
 * Canonical output paths for media assets copied into a build (spec §18.2 ASSETS, §11.1).
 * The renderer's {@code $CMS_REF(media:...)} URL resolver and the ASSETS copy stage MUST
 * agree on these exact paths, so both share this single helper.
 *
 * <p>Primary binary: {@code assets/media/{uid}.{ext}}. Variant {@code V}:
 * {@code assets/media/{uid}-{V}.{ext}} (the extension follows the variant's format).
 *
 * <p>A localized media file (M27.3.2) is written once per locale that publishes its own file, under that locale's
 * prefix — exactly the segment the locale's pages get for {@code {locale}}: {@code en/assets/media/{uid}.{ext}}, and
 * no prefix for the default locale when the project puts it at the site root.
 */
public final class MediaPaths {

    private MediaPaths() {}

    public static String mediaPath(String uid, String ext) {
        return "assets/media/" + uid + "." + ext;
    }

    public static String variantPath(String uid, String variantName, String ext) {
        return "assets/media/" + uid + "-" + variantName + "." + ext;
    }

    /** {@link #mediaPath} under {@code localePrefix} ({@link #localePrefix}). */
    public static String localizedMediaPath(String localePrefix, String uid, String ext) {
        return localePrefix + mediaPath(uid, ext);
    }

    /** {@link #variantPath} under {@code localePrefix} ({@link #localePrefix}). */
    public static String localizedVariantPath(String localePrefix, String uid, String variantName, String ext) {
        return localePrefix + variantPath(uid, variantName, ext);
    }

    /**
     * The path prefix of {@code locale}'s outputs: its tag and a slash, or nothing for the default locale when the
     * project sets "default locale without prefix", for a project without locales and for {@code null}. Mirrors how
     * {@code {locale}} expands in a page's output path.
     */
    public static String localePrefix(LocaleConfig config, String locale) {
        LocaleConfig locales = LocaleConfig.orEmpty(config);
        String declared = locale == null ? null : locales.canonicalDeclared(locale);
        if (declared == null || (locales.defaultWithoutPrefix() && declared.equals(locales.defaultLocale()))) {
            return "";
        }
        return declared + "/";
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
            case "text/html" -> "html";
            case "text/markdown", "text/x-web-markdown" -> "md";
            case "text/csv" -> "csv";
            case "text/x-yaml", "text/yaml", "application/yaml", "application/x-yaml" -> "yaml";
            case "text/calendar" -> "ics";
            case "text/vtt" -> "vtt";
            case "application/rss+xml" -> "rss";
            case "application/atom+xml" -> "atom";
            default -> textFallback(m);
        };
    }

    /**
     * Any other text media type still publishes with a text extension rather than {@code .bin}: {@code +json} as
     * {@code json}, {@code +xml} as {@code xml}, other {@code text/*} (such as {@code text/x-robots}) as {@code txt}.
     */
    private static String textFallback(String mimeType) {
        String bare = mimeType.contains(";") ? mimeType.substring(0, mimeType.indexOf(';')).trim() : mimeType;
        if (bare.endsWith("+json")) {
            return "json";
        }
        if (bare.endsWith("+xml")) {
            return "xml";
        }
        return bare.startsWith("text/") ? "txt" : "bin";
    }
}
