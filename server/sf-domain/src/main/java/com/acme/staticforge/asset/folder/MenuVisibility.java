package com.acme.staticforge.asset.folder;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;

/**
 * The "Visible in menu" flag of a navigation item (a {@code PAGE_REFERENCE}) or navigation folder: the payload field
 * {@value #FIELD}. <b>Absent means visible</b>, so every item stored before the flag existed stays in the generated
 * menu. A hidden item is left out of the menus templates build ({@code $CMS_NAVIGATION}, {@code $CMS_FOR … nav:}),
 * together with everything below it; it stays in the editor's navigation tree, its target page still exists and builds,
 * and entry-page and breadcrumb resolution ignore the flag.
 */
public final class MenuVisibility {

    /** The payload field holding the flag, a JSON boolean. */
    public static final String FIELD = "visibleInMenu";

    private MenuVisibility() {}

    /** Whether the item with this payload appears in generated menus; {@code true} when the field is absent or not a boolean. */
    public static boolean fromPayload(JsonNode payload) {
        JsonNode value = payload == null ? null : payload.get(FIELD);
        return value == null || !value.isBoolean() || value.asBoolean(true);
    }

    /** Stores the flag in {@code payload}. */
    public static void write(ObjectNode payload, boolean visible) {
        payload.put(FIELD, visible);
    }
}
