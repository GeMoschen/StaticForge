package com.acme.staticforge.search;

import com.acme.staticforge.asset.AssetType;
import java.util.List;
import java.util.UUID;

/**
 * One search result (M23.3.1).
 *
 * @param matchedIn where the best match is: the uid, the title, prose or code
 * @param snippet plain text around the matches (never HTML), with the matches as offset ranges into it
 */
public record SearchHit(
        UUID uuid,
        AssetType type,
        String uid,
        String displayName,
        String folderPath,
        UUID templateUuid,
        float score,
        MatchedIn matchedIn,
        Snippet snippet) {

    public enum MatchedIn {
        TITLE,
        UID,
        CONTENT,
        SOURCE
    }

    /** A plain-text excerpt; {@code highlights} are {@code [start, end)} offsets into {@code text}. */
    public record Snippet(String text, List<Range> highlights) {

        public Snippet {
            highlights = List.copyOf(highlights);
        }

        public static Snippet empty() {
            return new Snippet("", List.of());
        }
    }

    public record Range(int start, int end) {}
}
