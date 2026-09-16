package com.acme.staticforge.asset.template;

import com.acme.staticforge.template.content.ContentDefinition;
import com.acme.staticforge.template.content.EffectiveDefinition;
import com.acme.staticforge.template.octl.ChainCompileMemo;
import com.acme.staticforge.template.octl.Inheritance;
import com.acme.staticforge.template.octl.OctlCompiler;
import com.acme.staticforge.template.octl.OctlResult;
import com.acme.staticforge.template.octl.ParentSource;
import com.acme.staticforge.template.octl.ParentTemplateLoader;
import com.acme.staticforge.template.octl.ReferenceResolver;
import com.fasterxml.jackson.databind.JsonNode;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.function.Function;

/**
 * The page templates one consumer sees (M20): live, at a revision, a generation snapshot, or any of those
 * with a template's unsaved version laid over it. The single place inheritance reads template data from, so
 * save, validate, preview and generation load ancestors, walk {@code parentTemplateRef} for effective
 * definitions and compile chains the same way; only the {@code lookup} differs.
 *
 * <p>Lookups are memoized per instance, so an instance must not outlive the state it reads (one request, one
 * build). Thread-safe. Every lookup is recorded ({@link #lookups()}), which is what lets a cross-request compile
 * cache tell whether an entry's chain still matches.
 */
public final class TemplateHierarchy {

    /**
     * One live page template version as a hierarchy sees it.
     *
     * @param ownDefinition the version's own compiled CDL
     * @param versionKey identifies the version for cache validation ({@code validFromRevision}; {@code -1} for an
     *     unsaved overlay)
     */
    public record TemplateVersion(UUID uuid, String uid, JsonNode payload, ContentDefinition ownDefinition, long versionKey) {

        /** The channel's OCTL source, or {@code null} when the template has none (missing or blank). */
        public String channelSource(String channel) {
            JsonNode source = payload == null ? null : payload.path("channelTemplates").path(channel).get("source");
            return source == null || !source.isTextual() || source.asText().isBlank() ? null : source.asText();
        }

        /** The parent recorded on save ({@code payload.parentTemplateRef}), or {@code null}. */
        public UUID parentTemplateRef() {
            return parentTemplateRef(payload);
        }

        /** The parent a template payload records, or {@code null} (absent in data saved before M20). */
        public static UUID parentTemplateRef(JsonNode payload) {
            JsonNode ref = payload == null ? null : payload.get("parentTemplateRef");
            if (ref == null || !ref.isTextual() || ref.asText().isBlank()) {
                return null;
            }
            try {
                return UUID.fromString(ref.asText());
            } catch (IllegalArgumentException e) {
                return null;
            }
        }
    }

    private static final long ABSENT = Long.MIN_VALUE;

    private final Function<UUID, Optional<TemplateVersion>> lookup;
    private final Map<UUID, Optional<TemplateVersion>> versions = new ConcurrentHashMap<>();

    /** @param lookup the live, non-deleted page template with a UUID, or empty */
    public TemplateHierarchy(Function<UUID, Optional<TemplateVersion>> lookup) {
        this.lookup = lookup;
    }

    /** The page template {@code uuid}, or empty when it isn't a live page template here. */
    public Optional<TemplateVersion> version(UUID uuid) {
        if (uuid == null) {
            return Optional.empty();
        }
        return versions.computeIfAbsent(uuid, lookup);
    }

    /** This hierarchy with {@code proposed} in place of the stored version of its template. */
    public TemplateHierarchy overlay(TemplateVersion proposed) {
        return new TemplateHierarchy(uuid -> proposed.uuid().equals(uuid) ? Optional.of(proposed) : version(uuid));
    }

    /** A fresh hierarchy over the same lookup, with no memoized or recorded lookups. */
    public TemplateHierarchy fresh() {
        return new TemplateHierarchy(lookup);
    }

    /** Every template looked up so far → its version key, {@link Long#MIN_VALUE} for "not a live page template". */
    public Map<UUID, Long> lookups() {
        Map<UUID, Long> out = new LinkedHashMap<>();
        versions.forEach((uuid, version) -> out.put(uuid, version.map(TemplateVersion::versionKey).orElse(ABSENT)));
        return Collections.unmodifiableMap(out);
    }

    /** True when every recorded lookup of {@code recorded} still answers the same version here. */
    public boolean matches(Map<UUID, Long> recorded) {
        for (Map.Entry<UUID, Long> entry : recorded.entrySet()) {
            long now = version(entry.getKey()).map(TemplateVersion::versionKey).orElse(ABSENT);
            if (now != entry.getValue()) {
                return false;
            }
        }
        return true;
    }

    /** Ancestors for the OCTL chain compiler. */
    public ParentTemplateLoader loader() {
        return (uuid, channel) -> version(uuid)
                .map(version -> new ParentSource(uuid, version.uid(), version.channelSource(channel), version.ownDefinition()));
    }

    /**
     * The recorded ancestors of a template whose parent is {@code parentUuid}, parent first, following
     * {@code parentTemplateRef}. Stops at a missing template, a repeated one, or past the depth cap, so stored
     * data from an interrupted save can never loop.
     */
    public List<TemplateVersion> ancestors(UUID self, UUID parentUuid) {
        List<TemplateVersion> chain = new ArrayList<>();
        Set<UUID> seen = new HashSet<>();
        if (self != null) {
            seen.add(self);
        }
        UUID next = parentUuid;
        while (next != null && seen.add(next) && chain.size() <= OctlCompiler.MAX_INHERITANCE_DEPTH) {
            Optional<TemplateVersion> version = version(next);
            if (version.isEmpty()) {
                break;
            }
            chain.add(version.get());
            next = version.get().parentTemplateRef();
        }
        return chain;
    }

    /** The own definitions of those ancestors, root first: the layers a descendant's definition is merged onto. */
    public List<EffectiveDefinition.Layer> ancestorDefinitions(UUID self, UUID parentUuid) {
        List<TemplateVersion> ancestors = ancestors(self, parentUuid);
        List<EffectiveDefinition.Layer> layers = new ArrayList<>();
        for (int i = ancestors.size() - 1; i >= 0; i--) {
            layers.add(new EffectiveDefinition.Layer(ancestors.get(i).uid(), ancestors.get(i).ownDefinition()));
        }
        return layers;
    }

    /** The effective definition of {@code template}: its recorded ancestors' definitions and its own. */
    public EffectiveDefinition effectiveDefinition(TemplateVersion template) {
        List<EffectiveDefinition.Layer> layers =
                new ArrayList<>(ancestorDefinitions(template.uuid(), template.parentTemplateRef()));
        layers.add(new EffectiveDefinition.Layer(template.uid(), template.ownDefinition()));
        return EffectiveDefinition.merge(layers);
    }

    /** The effective definition of page template {@code uuid}; empty when it isn't a live page template here. */
    public Optional<EffectiveDefinition> effectiveDefinition(UUID uuid) {
        return version(uuid).map(this::effectiveDefinition);
    }

    /**
     * Compiles one channel source of a page template against its chain: the ancestors its {@code $CMS_EXTENDS}
     * names come from this hierarchy; a source that doesn't extend is still checked against the CDL the
     * template inherits through {@code declaredParent}.
     *
     * @param uuid the template, {@code null} when unsaved
     * @param declaredParent the parent the template records (or will record), {@code null} for none
     * @param memo shared compiled ancestors, or {@code null}
     */
    public OctlResult compile(
            OctlCompiler compiler,
            ReferenceResolver references,
            UUID uuid,
            String uid,
            String channel,
            String source,
            ContentDefinition ownDefinition,
            UUID declaredParent,
            ChainCompileMemo memo) {
        List<EffectiveDefinition.Layer> inherited = declaredParent == null ? null : ancestorDefinitions(uuid, declaredParent);
        return compiler.compile(
                source, channel, references, ownDefinition, new Inheritance(uuid, uid, loader(), memo, inherited));
    }
}
