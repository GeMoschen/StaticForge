package com.acme.staticforge.template.octl;

import com.acme.staticforge.template.query.DatasetQuery;
import java.util.Collections;
import java.util.EnumSet;
import java.util.IdentityHashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
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
    private final Map<String, Set<ReferenceUse>> referenceUses;
    private final Map<OctlNode.For, DatasetQuery> datasetQueries;

    CompiledTemplate(
            String channelKey,
            String hash,
            List<OctlNode> nodes,
            Map<String, UUID> references,
            Map<String, Set<ReferenceUse>> referenceUses,
            Map<OctlNode.For, DatasetQuery> datasetQueries) {
        this.channelKey = channelKey;
        this.hash = hash;
        this.nodes = List.copyOf(nodes);
        this.references = Map.copyOf(references);
        Map<String, Set<ReferenceUse>> uses = new LinkedHashMap<>();
        referenceUses.forEach((key, use) -> {
            if (this.references.containsKey(key) && !use.isEmpty()) {
                uses.put(key, Collections.unmodifiableSet(EnumSet.copyOf(use)));
            }
        });
        this.referenceUses = Collections.unmodifiableMap(uses);
        // Keyed by node identity: two textually identical loops are still two loops, and record
        // equality over a whole loop body would make every lookup walk the AST.
        Map<OctlNode.For, DatasetQuery> queries = new IdentityHashMap<>(datasetQueries);
        this.datasetQueries = Collections.unmodifiableMap(queries);
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

    /**
     * How the template uses each resolved reference: {@code assetType:uid -> uses}, with exactly
     * the keys of {@link #references()} (unmodifiable). A key used in several ways (for example
     * {@code $CMS_REF(page:about)$} and {@code $CMS_VALUE(page:about.title)$}) carries every use.
     */
    public Map<String, Set<ReferenceUse>> referenceUses() {
        return referenceUses;
    }

    /**
     * Internal: the query a {@code $CMS_FOR(x : dataset:uid, …)$} loop was compiled with (M19.3.2), so
     * its {@code where}/{@code sort}/{@code limit} are parsed once per compile, never per render;
     * {@code null} for any other node.
     */
    public DatasetQuery datasetQuery(OctlNode.For loop) {
        return datasetQueries.get(loop);
    }

    /**
     * The queries of every {@code $CMS_FOR(x : dataset:<datasetUid>, …)$} loop in the template, nested
     * loops included (M19.3.2): the only way a template reads a dataset's records, so incremental
     * planning can tell which record changes it renders.
     */
    public List<DatasetQuery> datasetQueries(String datasetUid) {
        return datasetQueries.entrySet().stream()
                .filter(entry -> datasetUid.equals(entry.getKey().accessor().uid()))
                .map(Map.Entry::getValue)
                .toList();
    }
}
