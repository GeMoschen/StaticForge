package com.acme.staticforge.revision;

import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;

/**
 * A single touched-asset entry in a revision's denormalized {@code summary} (spec §7.2):
 * {@code {"uuid":…, "type":…, "uid":…, "action":…, "fields":[…], "onBehalf":false}}.
 */
public record AssetChange(String uuid, String assetType, String uid, String action, java.util.List<String> fields, boolean onBehalf) {

    public static AssetChange create(String uuid, String assetType, String action, java.util.List<String> fields) {
        return new AssetChange(uuid, assetType, null, action, fields, false);
    }

    public void appendTo(ObjectNode summary) {
        ArrayNode assets = summary.withArray("assets");
        ObjectNode entry = assets.addObject();
        entry.put("uuid", uuid);
        entry.put("type", assetType);
        if (uid != null) {
            entry.put("uid", uid);
        }
        entry.put("action", action);
        if (fields != null && !fields.isEmpty()) {
            ArrayNode fs = entry.putArray("fields");
            fields.forEach(fs::add);
        }
        if (onBehalf) {
            entry.put("onBehalf", true);
        }
    }
}
