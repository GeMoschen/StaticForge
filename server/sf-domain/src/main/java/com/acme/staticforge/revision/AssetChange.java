package com.acme.staticforge.revision;

import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;

/**
 * A single touched-asset entry in a revision's denormalized {@code summary} (spec §7.2):
 * {@code {"uuid":…, "type":…, "uid":…, "action":…, "fields":[…], "onBehalf":false}}.
 *
 * <p>Release, unpublish and discard entries (M27.1.2) also name the {@code locale} they apply to ({@code ""} for
 * every locale) and, for a release, the {@code releasedVersion} id the pointer now points at.
 */
public record AssetChange(
        String uuid,
        String assetType,
        String uid,
        String action,
        java.util.List<String> fields,
        boolean onBehalf,
        String locale,
        Long releasedVersion) {

    public AssetChange(String uuid, String assetType, String uid, String action, java.util.List<String> fields, boolean onBehalf) {
        this(uuid, assetType, uid, action, fields, onBehalf, null, null);
    }

    public static AssetChange create(String uuid, String assetType, String action, java.util.List<String> fields) {
        return new AssetChange(uuid, assetType, null, action, fields, false);
    }

    /** A release-state entry (M27.1.2): {@code action} is {@code RELEASE}, {@code UNPUBLISH} or {@code DISCARD}. */
    public static AssetChange release(
            String uuid, String assetType, String uid, String action, String locale, Long releasedVersion) {
        return new AssetChange(uuid, assetType, uid, action, java.util.List.of(), false, locale, releasedVersion);
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
        if (locale != null) {
            entry.put("locale", locale);
        }
        if (releasedVersion != null) {
            entry.put("releasedVersion", releasedVersion);
        }
    }
}
