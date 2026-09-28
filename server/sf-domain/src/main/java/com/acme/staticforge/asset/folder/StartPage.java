package com.acme.staticforge.asset.folder;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.UUID;

/**
 * A {@code PAGES}-scoped folder's {@code startPage} (M31): the uuid of one of the folder's own pages, which renders as
 * the folder's index file in place of the channel's {@code indexUid} rule. {@code pages_root} may name one too (the
 * site's home page); the hidden shared {@code root} and folders of every other store never do.
 *
 * <p>The payload holds only the pointer. Whether it is <em>effective</em> in a view — the page exists there and still
 * lives in this folder — is decided by the reader (the build per locale, the live resolver on drafts): a stale pointer
 * simply doesn't match and the folder falls back to the {@code indexUid} rule. Not to be confused with a navigation
 * folder's {@link StartNode}, which picks the navigation entry that makes a nav folder clickable.
 */
public final class StartPage {

    /** The folder payload key. */
    public static final String PAYLOAD_KEY = "startPage";

    private StartPage() {}

    /** The folder's start page uuid, or {@code null} when the payload has none (absent, {@code null} or malformed). */
    public static UUID fromPayload(JsonNode payload) {
        if (payload == null) {
            return null;
        }
        JsonNode node = payload.get(PAYLOAD_KEY);
        if (node == null || !node.isTextual() || node.asText().isBlank()) {
            return null;
        }
        try {
            return UUID.fromString(node.asText());
        } catch (IllegalArgumentException e) {
            return null;
        }
    }
}
