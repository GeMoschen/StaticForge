package com.acme.staticforge.urlregistry;

import java.util.Objects;
import java.util.UUID;

/**
 * One output a URL registry row names (M32.1): a page's page {@code pageNumber}, a media file's {@code variant}
 * ({@code ""} for the primary file), or a folder's directory. Rows also carry a channel, an area and a language.
 *
 * @param variant a media variant's name; {@code ""} for every other target
 * @param pageNumber the page number of a paginated page's output; {@code 1} for every other target
 */
public record UrlTarget(UrlTargetType type, UUID uuid, String variant, int pageNumber) {

    public UrlTarget {
        Objects.requireNonNull(type, "type");
        Objects.requireNonNull(uuid, "uuid");
        variant = variant == null ? "" : variant;
        if (pageNumber < 1) {
            throw new IllegalArgumentException("pageNumber must be at least 1");
        }
        if (type != UrlTargetType.MEDIA && !variant.isEmpty()) {
            throw new IllegalArgumentException("Only media targets have variants");
        }
        if (type != UrlTargetType.PAGE && pageNumber != 1) {
            throw new IllegalArgumentException("Only page targets have page numbers");
        }
    }

    /** Page 1 of {@code page}. */
    public static UrlTarget page(UUID page) {
        return new UrlTarget(UrlTargetType.PAGE, page, "", 1);
    }

    /** Page {@code pageNumber} of a paginated page. */
    public static UrlTarget page(UUID page, int pageNumber) {
        return new UrlTarget(UrlTargetType.PAGE, page, "", pageNumber);
    }

    /** A media file's primary file ({@code variant} {@code null} or blank) or one of its variants. */
    public static UrlTarget media(UUID media, String variant) {
        return new UrlTarget(UrlTargetType.MEDIA, media, variant == null || variant.isBlank() ? "" : variant, 1);
    }

    /** A folder's directory (only for a folder without an index page). */
    public static UrlTarget folder(UUID folder) {
        return new UrlTarget(UrlTargetType.FOLDER, folder, "", 1);
    }

    /** The target {@code entry} names. */
    public static UrlTarget of(UrlRegistryEntry entry) {
        return new UrlTarget(entry.getTargetType(), entry.getTargetUuid(), entry.getVariantKey(), entry.getPageNumber());
    }

    /** Media rows are channel-independent: they carry this channel key. */
    public static final String NO_CHANNEL = "";

    /** The channel key a row of this target carries in {@code channel}: {@link #NO_CHANNEL} for media. */
    public String channelKey(String channel) {
        return type == UrlTargetType.MEDIA ? NO_CHANNEL : channel;
    }

    /** For messages: {@code page 3a0…}, {@code page 3a0… (page 2)}, {@code media 3a0… (thumb)}. */
    public String describe() {
        String name = type.name().toLowerCase(java.util.Locale.ROOT) + " " + uuid;
        if (!variant.isEmpty()) {
            return name + " (" + variant + ")";
        }
        return pageNumber > 1 ? name + " (page " + pageNumber + ")" : name;
    }
}
