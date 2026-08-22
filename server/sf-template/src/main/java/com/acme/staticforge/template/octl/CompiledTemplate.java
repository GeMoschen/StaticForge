package com.acme.staticforge.template.octl;

import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * An immutable, compiled OCTL template (spec §16.10, §16.4): the parsed AST plus the map of
 * {@code assetType:uid} references that were resolved to asset UUIDs at compile time.
 *
 * <p>Safe to share across threads and cache. The AST and reference map carried here are an
 * internal representation consumed by the renderer; they are exposed only for that purpose
 * and are not part of the stable public API of {@code sf-template}.
 *
 * @param channelKey the channel this template was compiled for (for example {@code "html"})
 * @param hash a stable content hash for cache and persistence keys
 */
public final class CompiledTemplate {

    private final String channelKey;
    private final String hash;
    private final List<OctlNode> nodes;
    private final Map<String, UUID> references;

    CompiledTemplate(String channelKey, String hash, List<OctlNode> nodes, Map<String, UUID> references) {
        this.channelKey = channelKey;
        this.hash = hash;
        this.nodes = List.copyOf(nodes);
        this.references = Map.copyOf(references);
    }

    /** The channel key this template was compiled for. */
    public String channelKey() {
        return channelKey;
    }

    /** A stable content hash of the template source (for cache + persistence). */
    public String hash() {
        return hash;
    }

    /** Internal: the parsed AST root (unmodifiable). */
    public List<OctlNode> nodes() {
        return nodes;
    }

    /** Internal: resolved {@code assetType:uid -> UUID} references (unmodifiable). */
    public Map<String, UUID> references() {
        return references;
    }
}
