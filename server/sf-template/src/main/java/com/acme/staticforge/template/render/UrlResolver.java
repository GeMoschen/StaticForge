package com.acme.staticforge.template.render;

import java.util.Map;

/**
 * Resolves a resolved reference target to its URL/href for the current channel (spec §16.4).
 * {@code $CMS_REF} calls this with the target's kind, original UID, resolved UUID and any
 * named arguments (for example {@code variant="w1600"}).
 */
@FunctionalInterface
public interface UrlResolver {

    /**
     * @param kind the target kind: {@code "page"}, {@code "media"} or {@code "folder"}
     * @param uid the original {@code assetType:uid} UID (or editor name for editor references)
     * @param uuid the resolved target asset UUID
     * @param args named arguments (for example {@code variant})
     * @return the URL/href to emit, or {@code null}/{@code ""} when not resolvable
     */
    String resolve(String kind, String uid, java.util.UUID uuid, Map<String, String> args);
}
