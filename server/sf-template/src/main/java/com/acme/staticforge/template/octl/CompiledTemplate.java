package com.acme.staticforge.template.octl;

import com.acme.staticforge.template.content.EffectiveDefinition;
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
    private final Chain chain;

    CompiledTemplate(
            String channelKey,
            String hash,
            List<OctlNode> nodes,
            Map<String, UUID> references,
            Map<String, Set<ReferenceUse>> referenceUses,
            Map<OctlNode.For, DatasetQuery> datasetQueries) {
        this(channelKey, hash, nodes, references, referenceUses, datasetQueries, null);
    }

    CompiledTemplate(
            String channelKey,
            String hash,
            List<OctlNode> nodes,
            Map<String, UUID> references,
            Map<String, Set<ReferenceUse>> referenceUses,
            Map<OctlNode.For, DatasetQuery> datasetQueries,
            Chain chain) {
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
        this.chain = chain == null ? Chain.standalone(this.nodes) : chain;
    }

    /**
     * How a template renders along its inheritance chain (M20).
     *
     * @param layoutNodes the root layout's AST: what renders
     * @param setupNodes the top-level {@code $CMS_SET}s of every template that extends, root-most first,
     *     evaluated before the layout (so the most-derived value of a variable wins)
     * @param blocks block name → its definitions, most-derived first, root last
     * @param ancestors the chain above this template, parent first
     * @param parentUuid the parent this template's {@code $CMS_EXTENDS} resolved to, or {@code null}
     * @param effectiveDefinition the definition names were checked against, or {@code null} when the compile
     *     skipped name checks
     */
    record Chain(
            List<OctlNode> layoutNodes,
            List<OctlNode> setupNodes,
            Map<String, List<List<OctlNode>>> blocks,
            List<Ancestor> ancestors,
            UUID parentUuid,
            EffectiveDefinition effectiveDefinition) {

        Chain {
            layoutNodes = List.copyOf(layoutNodes);
            setupNodes = List.copyOf(setupNodes);
            Map<String, List<List<OctlNode>>> copy = new LinkedHashMap<>();
            blocks.forEach((name, definitions) -> copy.put(name, List.copyOf(definitions)));
            blocks = Collections.unmodifiableMap(copy);
            ancestors = List.copyOf(ancestors);
        }

        static Chain standalone(List<OctlNode> nodes) {
            Map<String, List<List<OctlNode>>> blocks = new LinkedHashMap<>();
            InheritanceRules.blocks(nodes).forEach((name, body) -> blocks.put(name, List.of(body)));
            return new Chain(nodes, List.of(), blocks, List.of(), null, null);
        }
    }

    /** One ancestor of a compiled template (M20). */
    public record Ancestor(UUID uuid, String uid) {}

    /** The channel key this template was compiled for. */
    public String channelKey() {
        return channelKey;
    }

    /**
     * A stable content hash for cache and persistence keys: of the channel and source, and for a template
     * that extends also of every ancestor's UUID and source (M20), so it changes when any layer changes.
     */
    public String hash() {
        return hash;
    }

    /**
     * Internal: the AST the renderer starts from (M20): the root layout's nodes for a template that
     * extends, otherwise {@link #nodes()}.
     */
    public List<OctlNode> layoutNodes() {
        return chain.layoutNodes();
    }

    /** Internal: the child-level {@code $CMS_SET}s evaluated before {@link #layoutNodes()}, root-most first (M20). */
    public List<OctlNode> setupNodes() {
        return chain.setupNodes();
    }

    /**
     * Internal: block name → definitions, most-derived first (M20). A template without a chain maps each of
     * its blocks to its one definition.
     */
    public Map<String, List<List<OctlNode>>> blocks() {
        return chain.blocks();
    }

    /** The templates this one extends, parent first; empty without a chain (M20). */
    public List<Ancestor> ancestors() {
        return chain.ancestors();
    }

    /**
     * The page template this template's {@code $CMS_EXTENDS} names, resolved at compile time, or {@code null}
     * when it doesn't extend or the target didn't resolve (M20).
     */
    public UUID parentUuid() {
        return chain.parentUuid();
    }

    /**
     * The effective content definition names were validated against (own + inherited, M20), or {@code null}
     * when the compile had no definition.
     */
    public EffectiveDefinition effectiveDefinition() {
        return chain.effectiveDefinition();
    }

    /** Internal: the template's own parsed AST root (unmodifiable). */
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

    /** Internal: every dataset loop's compiled query by loop node identity, for linking a chain (M20). */
    Map<OctlNode.For, DatasetQuery> datasetQueryMap() {
        return datasetQueries;
    }

    /**
     * Internal: the query a {@code $CMS_FOR(x : dataset:uid, …)$} loop — or a record set loop's narrowing,
     * {@code recordset:uid} or a {@code reference} editor with arguments (M25.2.2) — was compiled with (M19.3.2), so
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
                .filter(entry -> "dataset".equals(entry.getKey().accessor().assetType())
                        && datasetUid.equals(entry.getKey().accessor().uid()))
                .map(Map.Entry::getValue)
                .toList();
    }

    /**
     * How the template reads record set {@code recordset:<setUid>} (M25.2.3): the arguments of every loop over it
     * (nested loops included) and whether it reads the set any other way — the value form, which renders the records
     * through the dataset's record template, or a path into its root value object. Found by the uid as spelled, so it
     * works on a template compiled without a resolver; incremental planning uses it to prune record and record
     * template changes.
     */
    public RecordSetReads recordSetReads(String setUid) {
        List<DatasetQuery> loops = datasetQueries.entrySet().stream()
                .filter(entry -> OctlCompiler.RECORD_SET_PREFIX.equals(entry.getKey().accessor().assetType())
                        && setUid.equals(entry.getKey().accessor().uid())
                        && entry.getKey().accessor().path().isEmpty())
                .map(Map.Entry::getValue)
                .toList();
        boolean valueReads = ReferenceUseCollector.valueReads(nodes, datasetQueries)
                .contains(OctlCompiler.RECORD_SET_PREFIX + ":" + setUid);
        return loops.isEmpty() && !valueReads ? RecordSetReads.NONE : new RecordSetReads(loops, valueReads);
    }
}
