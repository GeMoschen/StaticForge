package com.acme.staticforge.asset.template;

import com.acme.staticforge.template.content.ContentDefinition;
import com.acme.staticforge.template.octl.OctlResult;
import com.acme.staticforge.template.octl.ReferenceResolver;
import com.github.benmanes.caffeine.cache.Cache;
import com.github.benmanes.caffeine.cache.Caffeine;
import io.micrometer.core.instrument.MeterRegistry;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.Objects;
import java.util.Optional;
import java.util.UUID;
import java.util.Map;
import java.util.function.BiFunction;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/**
 * Render-time compile caches for template CDL and OCTL (spec §21.5 {@code compiledTemplates},
 * {@code contentDefinitions}). Generation and preview compile through here instead of calling
 * the compilers directly; template save ({@code TemplateServiceImpl}) keeps compiling uncached,
 * since that is authoring-time validation.
 *
 * <p>Two tiers keep reference resolution correct:
 *
 * <ul>
 *   <li><b>Per build</b> — {@link #buildMemo(Object)}: a {@link TemplateCompileMemo} scoped to one
 *       generation snapshot, keyed by {@code (templateUuid, channel)}. Always safe, because the
 *       snapshot pins sources and UID → UUID mappings for the whole build.
 *   <li><b>Across requests</b> — {@link #compile}: used by preview, where project state moves
 *       between requests. The CDL definition depends only on the template version and is keyed
 *       {@code (projectId, templateUuid, validFromRevision)}. The OCTL result is keyed
 *       {@code (projectId, templateUuid, validFromRevision, channel)} — so a template or channel
 *       edit (a new version) and time travel (an older version) never hit another version's
 *       entry — but its {@code assetType:uid → UUID} resolutions depend on <em>other</em> assets
 *       (a renamed, deleted or newly created reference target). Every resolution the compiler
 *       asked for, including ones that failed, is recorded with the entry and re-resolved against
 *       the caller's current {@link ReferenceResolver} on each hit; if any answer differs, the
 *       entry is recompiled and replaced. Re-resolving a template's few references is far cheaper
 *       than lex + parse + validate, and a stale mapping can never be served. {@code projectId} is
 *       part of every key: UUIDs are only unique per project, and resolution is project-scoped.
 * </ul>
 *
 * <p>A page template that extends (M20) also depends on its ancestors' versions. Its entry records every page
 * template the chain compile looked up in the caller's {@link TemplateHierarchy} with the version it found; a hit
 * re-checks them the way it re-checks references, so a parent edit or a time-travel request for an older parent
 * never serves a stale layout. That is the chain-hash contract of {@code OctlCompiler}, checked without compiling.
 *
 * <p>Size ({@code sf.cache.compiled-templates.max-size}, default 2000) and idle expiry
 * ({@code sf.cache.compiled-templates.idle}, default 30m) bound the cross-request tier. Two
 * concurrent misses for the same key may both compile; the result is identical, so the last
 * write simply wins. Every real compile is counted in the {@code sf.template.compiles} meter
 * (tag {@code kind} = {@code cdl} | {@code octl}).
 */
@Component
public class CompiledTemplateCache {

    private final MeteredTemplateCompiler compiler;
    private final Cache<DefinitionKey, ContentDefinition> definitions;
    private final Cache<ChannelKey, Entry<CompiledChannel>> channels;
    private final Cache<TextMediaKey, Entry<OctlResult>> textMedia;
    private final Cache<Object, TemplateCompileMemo> buildMemos;

    public CompiledTemplateCache(
            MeterRegistry meterRegistry,
            @Value("${sf.cache.compiled-templates.max-size:2000}") long maxSize,
            @Value("${sf.cache.compiled-templates.idle:30m}") Duration idle) {
        this.compiler = new MeteredTemplateCompiler(meterRegistry);
        this.definitions = Caffeine.newBuilder().maximumSize(maxSize).expireAfterAccess(idle).build();
        this.channels = Caffeine.newBuilder().maximumSize(maxSize).expireAfterAccess(idle).build();
        this.textMedia = Caffeine.newBuilder().maximumSize(maxSize).expireAfterAccess(idle).build();
        // Weak, identity-compared keys: a build's memo lives exactly as long as its snapshot object.
        this.buildMemos = Caffeine.newBuilder().weakKeys().build();
    }

    /**
     * The per-build compile memo for {@code build} (the generation {@code Snapshot}): every caller
     * handed the same build object — for example a run's validate and render stages — shares one
     * memo, released once the build object is garbage.
     */
    public TemplateCompileMemo buildMemo(Object build) {
        return buildMemos.get(Objects.requireNonNull(build, "build"), b -> new TemplateCompileMemo(compiler));
    }

    /** The compiled CDL of one template version, cached by {@code (projectId, templateUuid, validFromRevision)}. */
    public ContentDefinition definition(long projectId, UUID templateUuid, long templateValidFromRevision, String cdlSource) {
        return definitions.get(
                new DefinitionKey(projectId, templateUuid, templateValidFromRevision), key -> compiler.definition(cdlSource));
    }

    /** A section template's channel: no inheritance chain (see the full overload). */
    public CompiledChannel compile(
            long projectId,
            UUID templateUuid,
            long templateValidFromRevision,
            String channel,
            String cdlSource,
            String octlSource,
            ReferenceResolver resolver) {
        return compile(projectId, templateUuid, templateValidFromRevision, channel, cdlSource, octlSource, resolver, null, null);
    }

    /**
     * Cross-request compile of one template version's channel (see the class Javadoc for the
     * validation strategy).
     *
     * @param templateValidFromRevision the {@code validFromRevision} of the template version whose
     *     sources are passed
     * @param resolver the current, project-scoped {@code assetType:uid} resolver
     * @param hierarchy the page templates as of the request (live, or at its revision) that a page template's chain
     *     is linked from, or {@code null} for a section template
     * @param template the page template version itself as {@code hierarchy} sees it, or {@code null}
     */
    public CompiledChannel compile(
            long projectId,
            UUID templateUuid,
            long templateValidFromRevision,
            String channel,
            String cdlSource,
            String octlSource,
            ReferenceResolver resolver,
            TemplateHierarchy hierarchy,
            TemplateHierarchy.TemplateVersion template) {
        ContentDefinition definition = definition(projectId, templateUuid, templateValidFromRevision, cdlSource);
        ChannelKey key = new ChannelKey(projectId, templateUuid, templateValidFromRevision, channel);
        if (hierarchy == null || template == null) {
            return cached(channels, key, resolver, null, (recording, lookups) ->
                    new CompiledChannel(compiler.channel(octlSource, channel, recording, definition), definition));
        }
        return cached(channels, key, resolver, hierarchy, (recording, lookups) -> new CompiledChannel(
                compiler.chain(lookups, templateUuid, template.uid(), octlSource, channel, recording, definition,
                        template.parentTemplateRef(), null),
                definition));
    }

    /**
     * Cross-request compile of one dataset version's record template for {@code channel} (M25), keyed and
     * validated exactly like a section template's channel ({@code (projectId, datasetUuid, validFromRevision,
     * channel)}, references re-resolved on every hit). The dataset's CDL is its schema: the record's fields are
     * the template's scope.
     *
     * @param datasetValidFromRevision the {@code validFromRevision} of the dataset version whose sources are passed
     * @param cdlSource the dataset's {@code contentDefinition}
     * @param octlSource the dataset's {@code channelTemplates.<channel>.source}
     */
    public CompiledChannel compileRecordTemplate(
            long projectId,
            UUID datasetUuid,
            long datasetValidFromRevision,
            String channel,
            String cdlSource,
            String octlSource,
            ReferenceResolver resolver) {
        ContentDefinition definition = definition(projectId, datasetUuid, datasetValidFromRevision, cdlSource);
        return cached(
                channels,
                new ChannelKey(projectId, datasetUuid, datasetValidFromRevision, channel),
                resolver,
                null,
                (recording, lookups) ->
                        new CompiledChannel(compiler.recordTemplate(octlSource, channel, recording, definition), definition));
    }

    /**
     * Cross-request compile of one processed text media file's source (M18.3.2), validated on
     * every hit exactly like {@link #compile}. The blob identifies the source — a version of localized media holds
     * one per locale (M27.3.2).
     */
    public OctlResult compileTextMedia(
            long projectId,
            UUID mediaUuid,
            String blobSha256,
            String channel,
            String source,
            boolean scriptLike,
            ReferenceResolver resolver) {
        return cached(
                textMedia,
                new TextMediaKey(projectId, mediaUuid, blobSha256, channel),
                resolver,
                null,
                (recording, lookups) -> compiler.textMedia(source, channel, recording, scriptLike));
    }

    private static <K, T> T cached(
            Cache<K, Entry<T>> cache, K key, ReferenceResolver resolver, TemplateHierarchy hierarchy,
            BiFunction<ReferenceResolver, TemplateHierarchy, T> compile) {
        Entry<T> cached = cache.getIfPresent(key);
        if (cached != null && cached.stillResolves(resolver) && (hierarchy == null || hierarchy.matches(cached.templates))) {
            return cached.compiled;
        }
        RecordingResolver recording = resolver == null ? null : new RecordingResolver(resolver);
        // A fresh view records exactly the page templates this compile looks up.
        TemplateHierarchy lookups = hierarchy == null ? null : hierarchy.fresh();
        T compiled = compile.apply(recording, lookups);
        Entry<T> fresh = new Entry<>(
                compiled,
                recording == null ? List.of() : List.copyOf(recording.resolutions),
                lookups == null ? Map.of() : lookups.lookups());
        cache.put(key, fresh);
        return fresh.compiled;
    }

    private record DefinitionKey(long projectId, UUID templateUuid, long validFromRevision) {}

    private record ChannelKey(long projectId, UUID assetUuid, long validFromRevision, String channel) {}

    private record TextMediaKey(long projectId, UUID mediaUuid, String blobSha256, String channel) {}

    /** One {@code assetType:uid} lookup the compiler made, and its answer ({@code null} = unresolvable). */
    private record Resolution(String assetType, String uid, UUID uuid) {}

    /** @param templates every page template a chain compile looked up → the version key it found */
    private record Entry<T>(T compiled, List<Resolution> resolutions, Map<UUID, Long> templates) {

        boolean stillResolves(ReferenceResolver resolver) {
            if (resolver == null) {
                return resolutions.isEmpty();
            }
            for (Resolution r : resolutions) {
                if (!Objects.equals(resolver.resolve(r.assetType(), r.uid()).orElse(null), r.uuid())) {
                    return false;
                }
            }
            return true;
        }
    }

    /** Delegates to the real resolver and records every lookup, so a cache hit can re-check them all. */
    private static final class RecordingResolver implements ReferenceResolver {
        private final ReferenceResolver delegate;
        private final List<Resolution> resolutions = new ArrayList<>();

        RecordingResolver(ReferenceResolver delegate) {
            this.delegate = delegate;
        }

        @Override
        public Optional<UUID> resolve(String assetType, String uid) {
            Optional<UUID> resolved = delegate.resolve(assetType, uid);
            Resolution resolution = new Resolution(assetType, uid, resolved.orElse(null));
            if (!resolutions.contains(resolution)) {
                resolutions.add(resolution);
            }
            return resolved;
        }
    }
}
