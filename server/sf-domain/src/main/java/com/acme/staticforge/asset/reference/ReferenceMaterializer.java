package com.acme.staticforge.asset.reference;

import com.acme.staticforge.asset.Asset;
import com.acme.staticforge.asset.AssetReference;
import com.acme.staticforge.asset.AssetReferenceRepository;
import com.acme.staticforge.asset.AssetRepository;
import com.acme.staticforge.asset.AssetType;
import com.acme.staticforge.asset.AssetVersion;
import com.acme.staticforge.asset.ReferenceKind;
import com.acme.staticforge.asset.content.ContentReferenceService;
import com.acme.staticforge.asset.content.ExtractedReference;
import com.acme.staticforge.asset.media.TextMediaCompiler;
import com.acme.staticforge.asset.media.TextMediaTypes;
import com.acme.staticforge.revision.RevisionAware;
import com.acme.staticforge.template.cdl.CdlCompiler;
import com.acme.staticforge.template.cdl.CdlSources;
import com.acme.staticforge.template.content.ContentDefinition;
import com.acme.staticforge.template.octl.CompiledTemplate;
import com.acme.staticforge.template.octl.OctlCompiler;
import com.acme.staticforge.template.octl.OctlResult;
import com.acme.staticforge.template.octl.ReferenceResolver;
import com.acme.staticforge.template.octl.ReferenceUse;
import com.acme.staticforge.template.rules.RuleSet;
import com.fasterxml.jackson.databind.JsonNode;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;
import org.springframework.stereotype.Service;

/**
 * Keeps {@code asset_reference} in step with version writes (spec §5.4, ADR-0003): every code
 * path that inserts an {@link AssetVersion} calls this in the same transaction and with the same
 * revision, so the open rows of an asset are always exactly the edges derived from its current
 * version, and closed rows carry the revision the edge stopped being valid at.
 *
 * <p>Edges derived per asset type:
 * <ul>
 *   <li>{@code PAGE}: {@code templateRef} and each body section's {@code templateRef} as
 *       {@link ReferenceKind#TEMPLATE}; content and section-content values via
 *       {@link ContentReferenceService#extract} ({@code MEDIA_REF}/{@code CONTENT_REF}).</li>
 *   <li>{@code PAGE_REFERENCE}: its {@code target.assetUuid} as {@link ReferenceKind#NAV}.</li>
 *   <li>{@code PAGE_TEMPLATE}, {@code SECTION_TEMPLATE}: the OCTL references of every channel source
 *       as {@code OCTL_VALUE}/{@code OCTL_REF}/{@code OCTL_INCLUDE}, with source path
 *       {@code channelTemplates.<channel>}. Sections placed in page bodies are not duplicated here;
 *       those are the pages' {@code TEMPLATE} edges. A page template that extends another (M20) also has
 *       its {@code parentTemplateRef} as {@link ReferenceKind#TEMPLATE}, so usages, export and incremental
 *       builds see the chain.</li>
 *   <li>{@code MEDIA} with {@code processCms} on (M18.2.1): the OCTL references of the source blob,
 *       compiled with the text media profile, as {@code OCTL_*} edges with source path {@code source}.
 *       Unprocessed media has none, so switching the flag off closes them.</li>
 *   <li>{@code GLOBAL_SET}: its values' content references.</li>
 *   <li>{@code RECORD} (M19.1.2): {@code datasetRef} as {@link ReferenceKind#TEMPLATE} plus its values'
 *       content references.</li>
 *   <li>{@code RECORD_SET} (M25): {@code datasetRef} as {@link ReferenceKind#TEMPLATE}. A record's place in
 *       its set is its parent, not a reference.</li>
 *   <li>{@code DATASET} (M25.2.1): the OCTL references of its per-channel record templates, exactly like a
 *       section template's, with source path {@code channelTemplates.<channel>}; its CDL schema makes none.</li>
 *   <li>{@code FOLDER}: none.</li>
 * </ul>
 *
 * <p>The write is a per-edge diff rather than close-all-then-insert-all: an edge present in both
 * the open rows and the new edge set keeps its open row untouched, so a move or a payload edit
 * that doesn't change references writes nothing. A row that would be closed in the revision it
 * was opened in is deleted instead, and an edge closed earlier in the same revision is re-opened
 * rather than duplicated — a compound revision ({@code M15}) touching one asset twice never
 * leaves zero-length intervals behind. Target UUIDs that don't resolve to an asset of the project
 * are skipped (the broken-link report is a separate concern).
 */
@Service
@RevisionAware
public class ReferenceMaterializer {

    /** The source path of every edge a processed media file's source makes. */
    public static final String MEDIA_SOURCE_PATH = "source";

    private final AssetReferenceRepository references;
    private final AssetRepository assets;
    private final ContentReferenceService contentReferences;
    private final ProjectReferenceResolver projectReferences;
    private final TextMediaCompiler textMediaCompiler;
    private final OctlCompiler octlCompiler = new OctlCompiler();
    private final CdlCompiler cdlCompiler = new CdlCompiler();

    public ReferenceMaterializer(
            AssetReferenceRepository references,
            AssetRepository assets,
            ContentReferenceService contentReferences,
            ProjectReferenceResolver projectReferences,
            TextMediaCompiler textMediaCompiler) {
        this.references = references;
        this.assets = assets;
        this.contentReferences = contentReferences;
        this.projectReferences = projectReferences;
        this.textMediaCompiler = textMediaCompiler;
    }

    /**
     * Syncs the outgoing edges of {@code asset} with {@code version}, a version just written at
     * {@code version.getValidFromRevision()}: a deleted version has no outgoing edges.
     */
    public void materialize(Asset asset, AssetVersion version) {
        if (version.isDeleted()) {
            closeOutgoing(asset.getId(), version.getValidFromRevision());
        } else {
            replaceOutgoing(
                    asset.getProjectId(), asset.getId(), version.getValidFromRevision(), asset.getAssetType(),
                    version.getPayload());
        }
    }

    /** Replaces the open outgoing edges of {@code fromAssetId} with those derived from {@code payload}. */
    public void replaceOutgoing(long projectId, long fromAssetId, long revisionId, AssetType type, JsonNode payload) {
        apply(fromAssetId, revisionId, extract(projectId, type, payload));
    }

    /** Closes every open outgoing edge of {@code fromAssetId} at {@code revisionId} (soft delete). */
    public void closeOutgoing(long fromAssetId, long revisionId) {
        apply(fromAssetId, revisionId, Set.of());
    }

    /**
     * The deduplicated edge set derived from a payload of the given asset type, with target UUIDs
     * resolved to asset ids in one lookup; unresolvable targets are dropped. No writes.
     */
    public Set<ReferenceEdge> extract(long projectId, AssetType type, JsonNode payload) {
        List<ExtractedReference> found = payload == null || payload.isNull() ? List.of() : switch (type) {
            case PAGE -> pageReferences(payload);
            case PAGE_REFERENCE -> navigationReferences(payload);
            case PAGE_TEMPLATE, SECTION_TEMPLATE, DATASET -> templateReferences(projectId, payload);
            case GLOBAL_SET -> {
                List<ExtractedReference> refs = new ArrayList<>(contentReferences.extract(payload.get("content"), "content"));
                refs.addAll(ruleReferences(projectId, payload));
                yield refs;
            }
            case RECORD -> recordReferences(payload);
            case RECORD_SET -> recordSetReferences(payload);
            case MEDIA -> mediaReferences(projectId, payload);
            case FOLDER -> List.of();
        };
        if (found.isEmpty()) {
            return Set.of();
        }

        Set<UUID> targets = new LinkedHashSet<>();
        found.forEach(ref -> targets.add(ref.target()));
        Map<UUID, Long> idsByUuid = new HashMap<>();
        for (Asset target : assets.findByProjectIdAndUuidIn(projectId, targets)) {
            idsByUuid.put(target.getUuid(), target.getId());
        }

        Set<ReferenceEdge> edges = new LinkedHashSet<>();
        for (ExtractedReference ref : found) {
            Long toAssetId = idsByUuid.get(ref.target());
            if (toAssetId != null) {
                edges.add(new ReferenceEdge(toAssetId, ref.kind(), ref.sourcePath()));
            }
        }
        return edges;
    }

    private List<ExtractedReference> pageReferences(JsonNode payload) {
        List<ExtractedReference> found = new ArrayList<>();
        addTemplate(found, payload.get("templateRef"), "templateRef");
        found.addAll(contentReferences.extract(payload.get("content"), "content"));

        JsonNode bodies = payload.get("bodies");
        if (bodies != null && bodies.isObject()) {
            bodies.fields().forEachRemaining(body -> {
                JsonNode sections = body.getValue();
                if (sections == null || !sections.isArray()) {
                    return;
                }
                for (int i = 0; i < sections.size(); i++) {
                    JsonNode section = sections.get(i);
                    String path = "bodies." + body.getKey() + "[" + i + "]";
                    addTemplate(found, section.get("templateRef"), path + ".templateRef");
                    found.addAll(contentReferences.extract(section.get("content"), path + ".content"));
                }
            });
        }
        return found;
    }

    /**
     * A record's edges (M19.1.2): its {@code datasetRef} as {@link ReferenceKind#TEMPLATE} (so the
     * dataset's usages and the planner can walk from a record to the templates looping its dataset)
     * plus the references in its values, exactly like a page's content.
     */
    /** A record set's {@code datasetRef} (M25); its stored query names fields, never assets. */
    private static List<ExtractedReference> recordSetReferences(JsonNode payload) {
        List<ExtractedReference> found = new ArrayList<>();
        addTemplate(found, payload.get("datasetRef"), "datasetRef");
        return found;
    }

    private List<ExtractedReference> recordReferences(JsonNode payload) {
        List<ExtractedReference> found = new ArrayList<>();
        addTemplate(found, payload.get("datasetRef"), "datasetRef");
        found.addAll(contentReferences.extract(payload.get("content"), "content"));
        return found;
    }

    /**
     * OCTL edges of every channel source: each channel is compiled against the project resolver
     * (without the content definition, which only drives name diagnostics, not reference
     * resolution) and every resolved reference becomes one edge per use, addressed by
     * {@code channelTemplates.<channel>}. Unresolvable references are simply absent.
     */
    private List<ExtractedReference> templateReferences(long projectId, JsonNode payload) {
        List<ExtractedReference> found = new ArrayList<>(ruleReferences(projectId, payload));
        JsonNode channels = payload.get("channelTemplates");
        if (channels == null || !channels.isObject()) {
            return found;
        }
        ReferenceResolver resolver = projectReferences.forProject(projectId);
        addTemplate(found, payload.get("parentTemplateRef"), "parentTemplateRef");
        channels.fields().forEachRemaining(channel -> {
            JsonNode source = channel.getValue() == null ? null : channel.getValue().get("source");
            if (source == null || !source.isTextual() || source.asText().isEmpty()) {
                return;
            }
            CompiledTemplate compiled = octlCompiler.compile(source.asText(), channel.getKey(), resolver).template();
            addOctlReferences(found, compiled, "channelTemplates." + channel.getKey());
        });
        return found;
    }

    /**
     * {@code RULE_REFERENCE} edges (M33.7): the property sets the CDL's editor rules read ({@code global:<uid>}), one
     * per set and reader. Only this layer's own rules: an inherited rule's reads are the parent template's edges, and
     * the planner walks {@code parentTemplateRef} to its children.
     */
    private List<ExtractedReference> ruleReferences(long projectId, JsonNode payload) {
        CdlSources cdl = CdlSources.of(payload);
        if (!cdl.text().contains("global:")) {
            return List.of();
        }
        ContentDefinition definition = cdlCompiler.compile(cdl).definition();
        if (definition == null) {
            return List.of();
        }
        List<ExtractedReference> found = new ArrayList<>();
        for (RuleSet.GlobalRead read : definition.rules().globalReads()) {
            assets.findByProjectIdAndAssetTypeAndUid(projectId, AssetType.GLOBAL_SET, read.setUid())
                    .ifPresent(set -> found.add(new ExtractedReference(ReferenceKind.RULE_REFERENCE, set.getUuid(), read.source())));
        }
        return found;
    }

    /** OCTL edges of a processed text media file's source blob; none for unprocessed media. */
    private List<ExtractedReference> mediaReferences(long projectId, JsonNode payload) {
        if (!TextMediaTypes.isProcessed(payload)) {
            return List.of();
        }
        OctlResult result = textMediaCompiler.compilePayload(projectId, payload);
        if (result == null) {
            return List.of();
        }
        List<ExtractedReference> found = new ArrayList<>();
        addOctlReferences(found, result.template(), MEDIA_SOURCE_PATH);
        return found;
    }

    /** One edge per resolved reference per use, addressed by {@code path}. */
    private static void addOctlReferences(List<ExtractedReference> found, CompiledTemplate compiled, String path) {
        compiled.referenceUses().forEach((key, uses) -> {
            UUID target = compiled.references().get(key);
            uses.forEach(use -> found.add(new ExtractedReference(referenceKind(use), target, path)));
        });
    }

    private static ReferenceKind referenceKind(ReferenceUse use) {
        return switch (use) {
            case VALUE -> ReferenceKind.OCTL_VALUE;
            case REF -> ReferenceKind.OCTL_REF;
            case INCLUDE -> ReferenceKind.OCTL_INCLUDE;
        };
    }

    private static List<ExtractedReference> navigationReferences(JsonNode payload) {
        UUID target = parseUuid(payload.path("target").get("assetUuid"));
        return target == null ? List.of() : List.of(new ExtractedReference(ReferenceKind.NAV, target, "target"));
    }

    private static void addTemplate(List<ExtractedReference> found, JsonNode templateRef, String path) {
        UUID target = parseUuid(templateRef);
        if (target != null) {
            found.add(new ExtractedReference(ReferenceKind.TEMPLATE, target, path));
        }
    }

    private void apply(long fromAssetId, long revisionId, Set<ReferenceEdge> edges) {
        Set<ReferenceEdge> missing = new LinkedHashSet<>(edges);
        for (AssetReference open : references.findByFromAssetIdAndValidToRevisionIsNull(fromAssetId)) {
            if (missing.remove(ReferenceEdge.of(open))) {
                continue;
            }
            if (Objects.equals(open.getValidFromRevision(), revisionId)) {
                references.delete(open);
            } else {
                open.setValidToRevision(revisionId);
                references.save(open);
            }
        }
        if (missing.isEmpty()) {
            return;
        }
        for (AssetReference closed : references.findByFromAssetIdAndValidToRevision(fromAssetId, revisionId)) {
            if (missing.remove(ReferenceEdge.of(closed))) {
                closed.setValidToRevision(null);
                references.save(closed);
            }
        }
        for (ReferenceEdge edge : missing) {
            references.save(new AssetReference(fromAssetId, revisionId, edge.toAssetId(), edge.kind(), edge.sourcePath()));
        }
    }

    private static UUID parseUuid(JsonNode value) {
        if (value == null || !value.isTextual() || value.asText().isBlank()) {
            return null;
        }
        try {
            return UUID.fromString(value.asText());
        } catch (IllegalArgumentException e) {
            return null;
        }
    }
}
