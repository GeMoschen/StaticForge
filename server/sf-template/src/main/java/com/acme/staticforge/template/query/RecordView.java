package com.acme.staticforge.template.query;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.MissingNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.fasterxml.jackson.databind.node.TextNode;
import java.time.Instant;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;

/**
 * One dataset record as the query model and templates see it (M19.3.1): its identity, its place in
 * the Content store and its editor values.
 *
 * <p>A record's <em>fields</em> are its editor values plus five reserved meta fields, the names a
 * {@code where}/{@code sort} expression and a loop item use:
 * {@code _uuid}, {@code _uid}, {@code _displayName}, {@code _folderPath} and {@code _changedAt}.
 * {@code _folderPath} is relative to the Content store root, with a leading and trailing slash
 * ({@code /} for a record directly in the store, {@code /team/leads/} deeper down); {@code _changedAt}
 * is an ISO-8601 instant.
 *
 * <p>{@link #item()} is the JSON object a template reads: the fields above plus the {@code _meta}
 * object every cross-asset value carries ({@code uid}, {@code displayName}). It is built once per
 * instance and never mutated, so one view can be shared by every render thread of a build.
 */
public final class RecordView {

    /** The reserved meta field names, in the order they are documented. */
    public static final Set<String> META_FIELDS = Set.of("_uuid", "_uid", "_displayName", "_folderPath", "_changedAt");

    private final UUID uuid;
    private final String uid;
    private final String displayName;
    private final String folderPath;
    private final Instant changedAt;
    private final JsonNode content;
    private final ObjectNode item;

    /**
     * @param folderPath the Content-store-relative folder path; normalized to a leading and trailing slash
     * @param content the record's editor values ({@code payload.content}); {@code null} means none
     */
    public RecordView(UUID uuid, String uid, String displayName, String folderPath, Instant changedAt, JsonNode content) {
        this.uuid = Objects.requireNonNull(uuid, "uuid");
        this.uid = uid == null ? "" : uid;
        this.displayName = displayName == null ? "" : displayName;
        this.folderPath = normalizeFolder(folderPath);
        this.changedAt = changedAt;
        this.content = content != null && content.isObject() ? content : JsonNodeFactory.instance.objectNode();
        this.item = buildItem();
    }

    public UUID uuid() {
        return uuid;
    }

    public String uid() {
        return uid;
    }

    public String displayName() {
        return displayName;
    }

    public String folderPath() {
        return folderPath;
    }

    public Instant changedAt() {
        return changedAt;
    }

    public JsonNode content() {
        return content;
    }

    /** The loop item / value object templates read. Shared: callers must not mutate it. */
    public JsonNode item() {
        return item;
    }

    /**
     * The same record with every language-dependent value resolved for {@code chain} (M24.3.3), so
     * {@code where}, {@code sort} and the loop item all see the language being rendered rather than
     * the wrapper. An empty chain, or a record with no language-dependent field, returns {@code this}.
     */
    public RecordView resolvedFor(java.util.List<String> chain) {
        if (chain == null || chain.isEmpty() || !com.acme.staticforge.common.L10nValues.containsL10n(content)) {
            return this;
        }
        return new RecordView(
                uuid,
                uid,
                displayName,
                folderPath,
                changedAt,
                com.acme.staticforge.common.L10nValues.resolveDeep(content, chain));
    }

    /** A field's value: a meta field, else the editor value; {@code MissingNode} when absent. */
    public JsonNode field(String name) {
        if (name == null) {
            return MissingNode.getInstance();
        }
        JsonNode value = item.get(name);
        return value == null ? MissingNode.getInstance() : value;
    }

    /**
     * Normalizes a Content folder path or {@code folder} argument to a leading and trailing slash:
     * {@code team}, {@code /team} and {@code team/} all become {@code /team/}; blank becomes {@code /}.
     */
    public static String normalizeFolder(String path) {
        if (path == null || path.isBlank()) {
            return "/";
        }
        String value = path.trim().replace('\\', '/');
        if (!value.startsWith("/")) {
            value = "/" + value;
        }
        if (!value.endsWith("/")) {
            value = value + "/";
        }
        return value;
    }

    private ObjectNode buildItem() {
        ObjectNode node = JsonNodeFactory.instance.objectNode();
        node.setAll((ObjectNode) content);
        node.set("_uuid", TextNode.valueOf(uuid.toString()));
        node.set("_uid", TextNode.valueOf(uid));
        node.set("_displayName", TextNode.valueOf(displayName));
        node.set("_folderPath", TextNode.valueOf(folderPath));
        node.set("_changedAt", changedAt == null ? JsonNodeFactory.instance.nullNode() : TextNode.valueOf(changedAt.toString()));
        ObjectNode meta = node.putObject("_meta");
        meta.put("uid", uid);
        meta.put("displayName", displayName);
        return node;
    }

    @Override
    public String toString() {
        return "RecordView[" + uid + "]";
    }
}
