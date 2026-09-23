package com.acme.staticforge.asset.folder;

import com.acme.staticforge.asset.AssetType;
import java.util.Locale;

/**
 * The single registry of OCTL {@code assetType:uid} accessor prefixes (spec §16.2, §16.4) — the
 * one place template save, preview and generation map a prefix onto the {@link AssetType} its uid
 * is looked up in. New prefixes ({@code global:}, {@code dataset:}, …) are registered here.
 */
public final class AssetReferencePrefixes {

    private AssetReferencePrefixes() {}

    /**
     * {@code assetType:uid} accessor prefix → {@link AssetType}, or {@code null} for an unknown
     * prefix. Every prefix but {@code nav} maps 1:1 onto an {@link AssetType} enum name; {@code
     * nav:<uid>} (`M8.1.4`) is special-cased since a navigation folder is still just {@link
     * AssetType#FOLDER} under the hood (`M8.1.2` — plain folders, no dedicated navigation-folder
     * asset type); resolve its uid through {@link FolderScope#navigationReferenceUid}.
     */
    public static AssetType assetTypeForRef(String prefix) {
        if ("nav".equals(prefix)) {
            return AssetType.FOLDER;
        }
        if ("global".equals(prefix)) {
            return AssetType.GLOBAL_SET;
        }
        try {
            AssetType type = AssetType.valueOf(prefix.toUpperCase(Locale.ROOT));
            // A record set's prefix is `recordset` (M25, epic decision 1), registered with its rendering;
            // the enum-derived `record_set` is deliberately not a second spelling.
            return type == AssetType.RECORD_SET ? null : type;
        } catch (IllegalArgumentException | NullPointerException e) {
            return null;
        }
    }
}
