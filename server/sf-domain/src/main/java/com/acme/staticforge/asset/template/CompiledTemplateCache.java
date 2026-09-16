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
import java.util.function.Function;
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
    private final Cache<ChannelKey, Entry<OctlResult>> textMedia;
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

    /**
     * Cross-request compile of one template version's channel (see the class Javadoc for the
     * validation strategy).
     *
     * @param templateValidFromRevision the {@code validFromRevision} of the template version whose
     *     sources are passed
     * @param resolver the current, project-scoped {@code assetType:uid} resolver
     */
    public CompiledChannel compile(
            long projectId,
            UUID templateUuid,
            long templateValidFromRevision,
            String channel,
            String cdlSource,
            String octlSource,
            ReferenceResolver resolver) {
        ContentDefinition definition = definitions.get(
                new DefinitionKey(projectId, templateUuid, templateValidFromRevision), key -> compiler.definition(cdlSource));
        return cached(
                channels,
                new ChannelKey(projectId, templateUuid, templateValidFromRevision, channel),
                resolver,
                recording -> new CompiledChannel(compiler.channel(octlSource, channel, recording, definition), definition));
    }

    /**
     * Cross-request compile of one processed text media version's source (M18.3.2), validated on
     * every hit exactly like {@link #compile}. The media version pins the blob, so
     * {@code mediaValidFromRevision} identifies the source.
     */
    public OctlResult compileTextMedia(
            long projectId,
            UUID mediaUuid,
            long mediaValidFromRevision,
            String channel,
            String source,
            boolean scriptLike,
            ReferenceResolver resolver) {
        return cached(
                textMedia,
                new ChannelKey(projectId, mediaUuid, mediaValidFromRevision, channel),
                resolver,
                recording -> compiler.textMedia(source, channel, recording, scriptLike));
    }

    private static <T> T cached(
            Cache<ChannelKey, Entry<T>> cache, ChannelKey key, ReferenceResolver resolver,
            Function<ReferenceResolver, T> compile) {
        Entry<T> cached = cache.getIfPresent(key);
        if (cached != null && cached.stillResolves(resolver)) {
            return cached.compiled;
        }
        RecordingResolver recording = resolver == null ? null : new RecordingResolver(resolver);
        T compiled = compile.apply(recording);
        Entry<T> fresh = new Entry<>(compiled, recording == null ? List.of() : List.copyOf(recording.resolutions));
        cache.put(key, fresh);
        return fresh.compiled;
    }

    private record DefinitionKey(long projectId, UUID templateUuid, long validFromRevision) {}

    private record ChannelKey(long projectId, UUID assetUuid, long validFromRevision, String channel) {}

    /** One {@code assetType:uid} lookup the compiler made, and its answer ({@code null} = unresolvable). */
    private record Resolution(String assetType, String uid, UUID uuid) {}

    private record Entry<T>(T compiled, List<Resolution> resolutions) {

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
