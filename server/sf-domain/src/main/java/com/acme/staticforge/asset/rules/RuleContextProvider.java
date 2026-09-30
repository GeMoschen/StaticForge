package com.acme.staticforge.asset.rules;

import com.fasterxml.jackson.databind.JsonNode;
import java.time.Clock;

/**
 * Everything the rule engine reads beyond the content itself (M33.3, epic decision 5) — the only I/O boundary of the
 * otherwise pure engine, so saves back it with the drafts, releases and builds with the released state (generation with
 * its snapshot). Every method may return {@code null} for "nothing"; {@link #NONE} provides nothing.
 */
public interface RuleContextProvider {

    RuleContextProvider NONE = new RuleContextProvider() {};

    /**
     * The meta object of the asset being checked — {@code {uid, name, path, template}} for a page, {@code {uid, name,
     * dataset}} for a record, {@code {uid, name}} for a property set — read as {@code page}, {@code record} or
     * {@code global} in expressions.
     */
    default JsonNode meta() {
        return null;
    }

    /** {@code release} in expressions: {@code {status}} of the asset in {@code locale} (NEW, PUBLISHED, CHANGED, …). */
    default JsonNode release(String locale) {
        return null;
    }

    /** {@code global:<set>} in expressions: the values of property set {@code setUid}, resolved for {@code locale}. */
    default JsonNode global(String setUid, String locale) {
        return null;
    }

    /**
     * {@code ref(value)}: a read-only view of the asset a media, link or reference value points at — {@code {uid, name,
     * path, mimeType, meta, content, release}} — the draft for edit/save and the released version for release and
     * generation; {@code null} when it points at nothing. Depth 1: the view's own references are not followed.
     */
    default JsonNode ref(JsonNode value, String locale) {
        return null;
    }

    /** The clock of {@code now()} and {@code today()}; its zone decides what "today" is. */
    default Clock clock() {
        return Clock.systemUTC();
    }
}
