package com.acme.staticforge.urlregistry;

import java.util.UUID;

/**
 * The reset scopes {@code UrlRegistryService.reset} supports (`M8.2.2`, {@code ASSET} since M32.1): a single entry,
 * every row of one asset, a whole channel, a whole area, or the whole project. Modeled as one discriminated record —
 * mirroring how {@code GenerationRequest} narrows its own scope with a {@code mode} enum plus nullable optional fields —
 * so {@code reset}'s call site stays a plain switch on {@link Kind}.
 */
public record ResetScope(Kind kind, Long entryId, String channelKey, UrlArea area, UUID targetUuid) {

    public enum Kind {
        ENTRY,
        ASSET,
        CHANNEL,
        AREA,
        PROJECT
    }

    /** Deletes exactly one entry, by its primary key. */
    public static ResetScope entry(long entryId) {
        return new ResetScope(Kind.ENTRY, entryId, null, null, null);
    }

    /**
     * Deletes every row of one asset (every channel, language, variant and page number) — in {@code area}, or in both
     * areas when {@code area} is {@code null}.
     */
    public static ResetScope asset(UUID targetUuid, UrlArea area) {
        if (targetUuid == null) {
            throw new IllegalArgumentException("targetUuid is required for an ASSET reset scope.");
        }
        return new ResetScope(Kind.ASSET, null, null, area, targetUuid);
    }

    /** Deletes every entry (both areas) for one channel in the project. */
    public static ResetScope channel(String channelKey) {
        if (channelKey == null || channelKey.isBlank()) {
            throw new IllegalArgumentException("channelKey is required for a CHANNEL reset scope.");
        }
        return new ResetScope(Kind.CHANNEL, null, channelKey, null, null);
    }

    /** Deletes every entry (every channel) in one area for the project. */
    public static ResetScope area(UrlArea area) {
        if (area == null) {
            throw new IllegalArgumentException("area is required for an AREA reset scope.");
        }
        return new ResetScope(Kind.AREA, null, null, area, null);
    }

    /** Deletes every entry for the project (every channel, both areas). */
    public static ResetScope project() {
        return new ResetScope(Kind.PROJECT, null, null, null, null);
    }
}
