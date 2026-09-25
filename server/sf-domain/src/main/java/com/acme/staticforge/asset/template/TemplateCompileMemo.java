package com.acme.staticforge.asset.template;

import com.acme.staticforge.template.content.ContentDefinition;
import com.acme.staticforge.template.octl.ChainCompileMemo;
import com.acme.staticforge.template.octl.OctlResult;
import com.acme.staticforge.template.octl.ReferenceResolver;
import io.micrometer.core.instrument.MeterRegistry;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicReference;
import java.util.function.Supplier;

/**
 * The per-build compile tier (spec §21.5): within one generation build every (template, channel)
 * compiles at most once, and every template's CDL at most once. Keys are just the template UUID
 * (and channel) because the build renders against one revision-pinned snapshot, which fixes both
 * the template sources and every {@code assetType:uid → UUID} resolution for the build's lifetime.
 * That is also why a memo must never outlive its build or be shared between builds.
 *
 * <p>Thread-safe: the render pipeline compiles from parallel virtual threads. A compile holds the
 * map's lock only for its own key's bin, and never recurses into the same map.
 */
public final class TemplateCompileMemo {

    private final MeteredTemplateCompiler compiler;
    private final Map<UUID, ContentDefinition> definitions = new ConcurrentHashMap<>();
    private final Map<ChannelKey, CompiledChannel> channels = new ConcurrentHashMap<>();
    private final Map<TextMediaKey, OctlResult> textMedia = new ConcurrentHashMap<>();
    private final ChainCompileMemo chains = new ChainCompileMemo();
    private final AtomicReference<TemplateHierarchy> hierarchy = new AtomicReference<>();

    /** A memo counting its compiles in {@code meterRegistry}. */
    public TemplateCompileMemo(MeterRegistry meterRegistry) {
        this(new MeteredTemplateCompiler(meterRegistry));
    }

    TemplateCompileMemo(MeteredTemplateCompiler compiler) {
        this.compiler = compiler;
    }

    /**
     * Returns the compiled channel, compiling the CDL and OCTL sources only on the first request
     * for this template (and channel) in this build.
     *
     * @param resolver the build's snapshot-backed {@code assetType:uid} resolver
     */
    public CompiledChannel compile(
            UUID templateUuid, String channel, String cdlSource, String octlSource, ReferenceResolver resolver) {
        return channels.computeIfAbsent(new ChannelKey(templateUuid, channel), key -> {
            ContentDefinition definition = definition(templateUuid, cdlSource);
            return new CompiledChannel(compiler.channel(octlSource, channel, resolver, definition), definition);
        });
    }

    /**
     * Returns a dataset's compiled record template for {@code channel} (M25), compiling only on the first request
     * for this dataset and channel in this build; every record of every set of the dataset renders with the one
     * result. The dataset's CDL (its schema) is compiled once and shared with {@link #definition}.
     *
     * @param cdlSource the dataset's {@code contentDefinition}
     * @param octlSource the dataset's {@code channelTemplates.<channel>.source}
     * @param resolver the build's snapshot-backed {@code assetType:uid} resolver
     */
    public CompiledChannel compileRecordTemplate(
            UUID datasetUuid, String channel, String cdlSource, String octlSource, ReferenceResolver resolver) {
        return channels.computeIfAbsent(new ChannelKey(datasetUuid, channel), key -> {
            ContentDefinition definition = definition(datasetUuid, cdlSource);
            return new CompiledChannel(compiler.recordTemplate(octlSource, channel, resolver, definition), definition);
        });
    }

    /**
     * Returns a page template's compiled channel against its inheritance chain (M20), compiling only on the first
     * request for this template and channel in this build. Ancestors compile once per build for all their
     * descendants.
     *
     * @param hierarchy the build's page templates ({@link #hierarchy})
     * @param declaredParent the template's recorded {@code parentTemplateRef}, or {@code null}
     */
    public CompiledChannel compilePageTemplate(
            UUID templateUuid,
            String templateUid,
            String channel,
            String cdlSource,
            String octlSource,
            ReferenceResolver resolver,
            TemplateHierarchy hierarchy,
            UUID declaredParent) {
        return channels.computeIfAbsent(new ChannelKey(templateUuid, channel), key -> {
            ContentDefinition definition = definition(templateUuid, cdlSource);
            return new CompiledChannel(
                    compiler.chain(hierarchy, templateUuid, templateUid, octlSource, channel, resolver, definition,
                            declaredParent, chains),
                    definition);
        });
    }

    /**
     * The build's page template hierarchy (M20), built by {@code build} on first use and shared by every stage of
     * the build afterwards.
     */
    public TemplateHierarchy hierarchy(Supplier<TemplateHierarchy> build) {
        TemplateHierarchy existing = hierarchy.get();
        if (existing != null) {
            return existing;
        }
        hierarchy.compareAndSet(null, build.get());
        return hierarchy.get();
    }

    /**
     * Returns the template's compiled CDL definition, compiling it only on the first request for
     * this template in this build (shared with {@link #compile}).
     */
    public ContentDefinition definition(UUID templateUuid, String cdlSource) {
        return definitions.computeIfAbsent(templateUuid, uuid -> compiler.definition(cdlSource));
    }

    /**
     * Returns a processed text media file's compiled source, compiling it only on the first request
     * for this media file in this build (M18.3.1). The snapshot pins the media version, and so its
     * blob, exactly like a template's sources.
     */
    public OctlResult textMedia(
            UUID mediaUuid, String channel, String source, boolean scriptLike, ReferenceResolver resolver) {
        // Keyed by the source too: a localized stylesheet has one source per locale (M27.3.2).
        return textMedia.computeIfAbsent(
                new TextMediaKey(mediaUuid, channel, source),
                key -> compiler.textMedia(source, channel, resolver, scriptLike));
    }

    private record ChannelKey(UUID templateUuid, String channel) {}

    private record TextMediaKey(UUID mediaUuid, String channel, String source) {}
}
