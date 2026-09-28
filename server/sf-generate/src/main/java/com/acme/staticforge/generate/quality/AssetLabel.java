package com.acme.staticforge.generate.quality;

import java.util.UUID;

/**
 * How a finding names an asset (M30): a rule reporting "image without alt" names the media file, a link rule the page it
 * links to.
 *
 * @param type the asset type's name ({@code PAGE}, {@code MEDIA}, …)
 */
public record AssetLabel(UUID uuid, String uid, String displayName, String type) {

    /** The uid, else the display name, else the uuid. */
    public String name() {
        if (uid != null && !uid.isBlank()) {
            return uid;
        }
        if (displayName != null && !displayName.isBlank()) {
            return displayName;
        }
        return String.valueOf(uuid);
    }
}
