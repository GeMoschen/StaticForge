package com.acme.staticforge.urlregistry;

/**
 * The four reset scopes {@code UrlRegistryService.reset} supports (`M8.2.2`): a single entry, a
 * whole channel, a whole area, or the whole project. Modeled as one discriminated record —
 * mirroring how {@code GenerationRequest} narrows its own scope with a {@code mode} enum plus
 * nullable optional fields — rather than a sealed interface hierarchy, since no sealed type
 * exists anywhere else in this codebase yet and a single record keeps {@code reset}'s call site
 * a plain switch on {@link Kind}.
 */
public record ResetScope(Kind kind, Long entryId, String channelKey, UrlArea area) {

    public enum Kind {
        ENTRY,
        CHANNEL,
        AREA,
        PROJECT
    }

    /** Deletes exactly one entry, by its primary key. */
    public static ResetScope entry(long entryId) {
        return new ResetScope(Kind.ENTRY, entryId, null, null);
    }

    /** Deletes every entry (both areas) for one channel in the project. */
    public static ResetScope channel(String channelKey) {
        if (channelKey == null || channelKey.isBlank()) {
            throw new IllegalArgumentException("channelKey is required for a CHANNEL reset scope.");
        }
        return new ResetScope(Kind.CHANNEL, null, channelKey, null);
    }

    /** Deletes every entry (every channel) in one area for the project. */
    public static ResetScope area(UrlArea area) {
        if (area == null) {
            throw new IllegalArgumentException("area is required for an AREA reset scope.");
        }
        return new ResetScope(Kind.AREA, null, null, area);
    }

    /** Deletes every entry for the project (every channel, both areas). */
    public static ResetScope project() {
        return new ResetScope(Kind.PROJECT, null, null, null);
    }
}
