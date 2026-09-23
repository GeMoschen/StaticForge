package com.acme.staticforge.asset.content;

import com.acme.staticforge.asset.AssetType;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.MissingNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.List;

/**
 * Builds the <em>root value object</em> a cross-asset accessor ({@code $CMS_VALUE(page:about.headline)$})
 * walks — the contract documented on {@code template.render.AssetValueResolver}. Generation (over its
 * snapshot) and preview (over live or time-travel versions) both project through this one pure
 * function, so they can never disagree on what another asset exposes:
 *
 * <ul>
 *   <li>{@code PAGE} — the editor values ({@code payload.content}); {@code bodies}, {@code nav},
 *       {@code output} and {@code meta} stay hidden so internal payload structure never becomes
 *       template API by accident;
 *   <li>{@code MEDIA} — a flat object of the descriptive fields ({@code altText, caption, copyright,
 *       fileName, mimeType, sizeBytes, width, height, orientation, dominantColor, focalPoint}); blob
 *       hashes and variants stay hidden;
 *   <li>{@code PAGE_REFERENCE} — {@code label};
 *   <li>{@code GLOBAL_SET} — the property set's values ({@code payload.content}), exactly like a
 *       page; {@code contentDefinition}/{@code compiledDefinition} stay hidden so a template
 *       reads a set's values, never its schema (M17.3.1);
 *   <li>{@code RECORD} — the record's values ({@code payload.content}), exactly like a page (M19.3.2).
 *       Renderers read records through {@code RecordValues}, which adds the record meta fields
 *       ({@code _uid}, {@code _folderPath}, …) on top;
 *   <li>templates, datasets, record sets (M25 renders a set, it has no values) and folders — no values.
 * </ul>
 *
 * <p>Every projection carries the reserved {@code _meta} object ({@code uid}, {@code displayName}).
 * A deleted asset projects to {@code MissingNode}. The returned node is built fresh (sharing the
 * payload's child nodes read-only), never a rendered output, so reading it cannot trigger a render.
 */
public final class AssetValueProjection {

    /** The reserved sub-object carrying identity fields. */
    public static final String META = "_meta";

    private static final List<String> MEDIA_FIELDS =
            List.of("altText", "caption", "copyright", "fileName", "mimeType", "sizeBytes", "focalPoint");
    private static final List<String> MEDIA_IMAGE_FIELDS = List.of("width", "height", "orientation", "dominantColor");

    private AssetValueProjection() {}

    /** The root value object of one asset version, or {@code MissingNode} when it is deleted. */
    public static JsonNode project(AssetType type, String uid, String displayName, JsonNode payload, boolean deleted) {
        if (deleted) {
            return MissingNode.getInstance();
        }
        ObjectNode root = JsonNodeFactory.instance.objectNode();
        JsonNode data = payload == null ? MissingNode.getInstance() : payload;
        switch (type) {
            case PAGE, GLOBAL_SET, RECORD -> {
                JsonNode content = data.path("content");
                if (content.isObject()) {
                    root.setAll((ObjectNode) content);
                }
            }
            case MEDIA -> {
                copy(data, MEDIA_FIELDS, root);
                copy(data.path("image"), MEDIA_IMAGE_FIELDS, root);
            }
            case PAGE_REFERENCE -> copy(data, List.of("label"), root);
            case SECTION_TEMPLATE, PAGE_TEMPLATE, FOLDER, DATASET, RECORD_SET -> { /* identity only */ }
        }
        root.putObject(META).put("uid", uid).put("displayName", displayName);
        return root;
    }

    private static void copy(JsonNode from, List<String> fields, ObjectNode to) {
        for (String field : fields) {
            JsonNode value = from.get(field);
            if (value != null) {
                to.set(field, value);
            }
        }
    }
}
