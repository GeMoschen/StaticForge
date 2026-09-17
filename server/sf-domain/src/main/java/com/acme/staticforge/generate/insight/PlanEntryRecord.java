package com.acme.staticforge.generate.insight;

import java.util.Locale;
import java.util.UUID;

/**
 * One planned output with its reason (M22.1.2): a page's output in one channel (one per page number of a paginated
 * page), or a processed text media file an incremental build re-renders ({@code channel == null}). The same record comes
 * from a fresh plan (dry run) and from a stored plan (a past run), so both are served alike.
 *
 * @param pageNumber the page number of a paginated page's output; {@code null} otherwise
 */
public record PlanEntryRecord(
        UUID assetUuid,
        String assetType,
        String uid,
        String displayName,
        String channel,
        String outputPath,
        Integer pageNumber,
        RebuildReason reason) {

    /** A stored plan's entry filter; {@code null} fields don't filter. */
    public record Filter(RebuildRootKind rootKind, String channel, UUID assetUuid, String query) {

        public static final Filter NONE = new Filter(null, null, null, null);

        /**
         * Whether {@code entry} passes: the same root kind, channel and asset, and a query contained in its uid, display
         * name or output path, ignoring case.
         */
        public boolean matches(PlanEntryRecord entry) {
            if (rootKind != null && entry.reason().rootKind() != rootKind) {
                return false;
            }
            if (channel != null && !channel.equals(entry.channel())) {
                return false;
            }
            if (assetUuid != null && !assetUuid.equals(entry.assetUuid())) {
                return false;
            }
            String q = normalizedQuery();
            return q == null
                    || contains(entry.uid(), q)
                    || contains(entry.displayName(), q)
                    || contains(entry.outputPath(), q);
        }

        /** The query in lower case; {@code null} when blank. */
        public String normalizedQuery() {
            return query == null || query.isBlank() ? null : query.trim().toLowerCase(Locale.ROOT);
        }

        private static boolean contains(String value, String query) {
            return value != null && value.toLowerCase(Locale.ROOT).contains(query);
        }
    }
}
