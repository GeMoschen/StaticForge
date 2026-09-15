package com.acme.staticforge.asset.template;

import com.acme.staticforge.template.content.ContentDefinition;
import com.acme.staticforge.template.octl.ReferenceResolver;
import io.micrometer.core.instrument.MeterRegistry;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

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
     * Returns the template's compiled CDL definition, compiling it only on the first request for
     * this template in this build (shared with {@link #compile}).
     */
    public ContentDefinition definition(UUID templateUuid, String cdlSource) {
        return definitions.computeIfAbsent(templateUuid, uuid -> compiler.definition(cdlSource));
    }

    private record ChannelKey(UUID templateUuid, String channel) {}
}
