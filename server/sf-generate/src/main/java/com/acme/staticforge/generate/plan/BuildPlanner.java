package com.acme.staticforge.generate.plan;

import com.acme.staticforge.asset.template.CompiledTemplateCache;
import com.acme.staticforge.asset.template.TemplateCompileMemo;
import com.acme.staticforge.generate.GenerationMode;
import com.acme.staticforge.generate.insight.FallbackCause;
import com.acme.staticforge.generate.insight.RebuildReason;
import com.acme.staticforge.generate.insight.RebuildRootKind;
import com.acme.staticforge.generate.render.MediaOutputs;
import com.acme.staticforge.generate.render.OutputPathResolver;
import com.acme.staticforge.generate.render.SnapshotPagination;
import com.acme.staticforge.generate.snapshot.Snapshot;
import com.acme.staticforge.generate.snapshot.SnapshotAsset;
import com.acme.staticforge.generate.target.BuildManifest;
import com.acme.staticforge.pagination.PaginationSource;
import com.acme.staticforge.pagination.PaginationValue;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import org.springframework.stereotype.Service;

/**
 * Build planner (spec §18.3): turns a snapshot into an ordered {@link BuildPlan}. A FULL build
 * covers every page × each requested channel; an INCREMENTAL build (with a {@link Baseline}) expands the assets
 * changed since the baseline revision over the reference graph ({@link RebuildExpansion}) and only renders the affected
 * pages, plus any output the base build doesn't hold (a page held back when it was built).
 *
 * <p>A paginated page (M21.2.1) is planned with every page number in every channel: its items are resolved once here
 * ({@link SnapshotPagination}) and handed to the renderer with the entries, so the count and the slices can't disagree.
 *
 * <p>Every planned asset gets a {@link RebuildReason} (M22.1.1): the change chain for a change-driven entry, else the
 * root kind — {@code FULL_BUILD}, {@code INCREMENTAL_FALLBACK_FULL} with its cause, {@code EXPLICIT_SCOPE} or
 * {@code NOT_IN_BASE_BUILD}.
 */
@Service
public class BuildPlanner {

    private static final Set<String> DEFAULT_CHANNELS = Set.of("html");

    private final CompiledTemplateCache compiledTemplates;
    private final RebuildExpansion expansion;

    public BuildPlanner(CompiledTemplateCache compiledTemplates, RebuildExpansion expansion) {
        this.compiledTemplates = compiledTemplates;
        this.expansion = expansion;
    }

    /**
     * Plans without a base build: INCREMENTAL counts changes since {@code lastSuccessfulRevision} (and plans FULL
     * without one), but no output is checked against a base build.
     */
    public BuildPlan plan(
            Snapshot snapshot,
            GenerationMode mode,
            Long lastSuccessfulRevision,
            Set<String> channels,
            String scopeFolderPath,
            Set<UUID> scopeAssetUuids,
            OutputPathResolver paths) {
        boolean incremental = mode == GenerationMode.INCREMENTAL;
        Baseline baseline = incremental && lastSuccessfulRevision != null ? new Baseline(lastSuccessfulRevision, null) : null;
        FallbackCause cause = incremental && baseline == null ? FallbackCause.NO_COMPLETE_BUILD_FOR_TARGET : null;
        return plan(snapshot, new PlanRequest(mode, baseline, cause, channels, scopeFolderPath, scopeAssetUuids), paths);
    }

    /** The channels a request plans: the requested ones, or the default channel when none are. */
    public static Set<String> effectiveChannels(java.util.Collection<String> requested) {
        return requested == null || requested.isEmpty() ? DEFAULT_CHANNELS : Set.copyOf(requested);
    }

    public BuildPlan plan(Snapshot snapshot, PlanRequest request, OutputPathResolver paths) {
        Set<String> channels = effectiveChannels(request.channels());
        TemplateCompileMemo memo = compiledTemplates.buildMemo(snapshot.root());
        List<PlanEntry> site = siteOutputs(snapshot, request, channels, memo, paths);

        Baseline baseline = request.mode() == GenerationMode.INCREMENTAL ? request.baseline() : null;
        if (baseline == null) {
            return fullPlan(snapshot, request, site);
        }

        BuildManifest manifest = baseline.manifest();
        Map<OutputKey, String> basePaths = basePaths(manifest);
        Map<UUID, Map<ChannelLocale, String>> firstPaths = firstPaths(site);
        // One walk per language (M27.2.2): an output is rebuilt when its language's walk reaches its page, so a
        // release in one language rebuilds only that language's outputs.
        RebuildExpansion.Walks walks = expansion.expandSince(
                snapshot, baseline.revision(), pageUuid -> moved(pageUuid, firstPaths, basePaths), memo, paths.locales(),
                urlChanged(snapshot, baseline, site, basePaths, paths));

        Map<UUID, RebuildReason> reasons = new HashMap<>();
        Map<UUID, Set<String>> siteLocales = new HashMap<>();
        Map<UUID, Set<String>> rebuiltLocales = new HashMap<>();
        List<PlanEntry> entries = new ArrayList<>();
        Set<OutputGroup> missing = new LinkedHashSet<>();
        for (PlanEntry output : site) {
            UUID page = output.pageUuid();
            RebuildExpansion.Result walk = walks.in(output.locale());
            if (output.locale() != null) {
                siteLocales.computeIfAbsent(page, k -> new java.util.TreeSet<>()).add(output.locale());
            }
            if (walk.reached(page)) {
                entries.add(output);
                reasons.computeIfAbsent(page, walk::reasonFor);
                if (output.locale() != null) {
                    rebuiltLocales.computeIfAbsent(page, k -> new java.util.TreeSet<>()).add(output.locale());
                }
            } else if (manifest != null
                    && !output.outputPath().equals(basePaths.get(new OutputKey(page, output.channel(), output.pageNumber(), output.locale())))) {
                missing.add(new OutputGroup(page, output.channel(), output.locale()));
            }
        }
        // A page rebuilt in fewer languages than it has records which ones (M24.3.2, M27.2.2).
        rebuiltLocales.forEach((page, locales) -> {
            if (!locales.equals(siteLocales.get(page))) {
                reasons.put(page, reasons.get(page).narrowedTo(List.copyOf(locales)));
            }
        });
        // An output the base build lacks is rendered with every other page number of its page in that channel.
        for (PlanEntry output : site) {
            OutputGroup group = new OutputGroup(output.pageUuid(), output.channel(), output.locale());
            if (missing.contains(group) && !walks.in(output.locale()).reached(output.pageUuid())) {
                entries.add(output);
                reasons.computeIfAbsent(output.pageUuid(), uuid -> ownRoot(snapshot, uuid, RebuildRootKind.NOT_IN_BASE_BUILD));
            }
        }
        Set<UUID> processedMedia = walks.processedMedia();
        for (UUID media : processedMedia) {
            reasons.put(media, walks.reasonFor(media));
        }
        entries.sort(ENTRY_ORDER);
        return new BuildPlan(
                true, snapshot.revision(), entries, walks.changedAssets(), processedMedia, site, reasons,
                walks.changeRevisions(), null, baseline.revision());
    }

    private static BuildPlan fullPlan(Snapshot snapshot, PlanRequest request, List<PlanEntry> site) {
        boolean fallback = request.mode() == GenerationMode.INCREMENTAL;
        FallbackCause cause = fallback
                ? Objects.requireNonNullElse(request.fallbackCause(), FallbackCause.NO_COMPLETE_BUILD_FOR_TARGET)
                : null;
        RebuildReason full = RebuildReason.of(
                fallback ? RebuildRootKind.INCREMENTAL_FALLBACK_FULL : RebuildRootKind.FULL_BUILD, cause, null, null, null);
        Map<UUID, RebuildReason> reasons = new HashMap<>();
        for (PlanEntry output : site) {
            UUID page = output.pageUuid();
            boolean explicit = request.scopeAssetUuids() != null && request.scopeAssetUuids().contains(page);
            reasons.computeIfAbsent(page, uuid -> explicit ? ownRoot(snapshot, uuid, RebuildRootKind.EXPLICIT_SCOPE) : full);
        }
        return new BuildPlan(false, snapshot.revision(), site, Set.of(), Set.of(), site, reasons, null, cause, null);
    }

    private static RebuildReason ownRoot(Snapshot snapshot, UUID uuid, RebuildRootKind kind) {
        SnapshotAsset asset = snapshot.assetByUuid(uuid);
        return RebuildReason.of(kind, null, uuid, asset.type().name(), asset.uid());
    }

    /** Every output of {@code pages} (live ones) in {@code channels}, with the paths generation writes, in entry order. */
    public List<PlanEntry> outputsOf(Snapshot snapshot, Set<UUID> pages, Set<String> channels, OutputPathResolver paths) {
        if (pages.isEmpty()) {
            return List.of();
        }
        PlanRequest request = new PlanRequest(GenerationMode.FULL, null, null, channels, null, pages);
        return siteOutputs(snapshot, request, effectiveChannels(channels), compiledTemplates.buildMemo(snapshot.root()), paths);
    }

    // ------------------------------------------------------------------
    // Site outputs
    // ------------------------------------------------------------------

    private static final Comparator<PlanEntry> ENTRY_ORDER = Comparator.comparing(PlanEntry::outputPath)
            .thenComparingInt(PlanEntry::pageNumber)
            .thenComparing(PlanEntry::pageUuid)
            // The language is null in a project without locales, so order it explicitly.
            .thenComparing(PlanEntry::locale, Comparator.nullsFirst(Comparator.naturalOrder()));

    /**
     * Every output of every live page in scope, in every channel, in entry order. A page has outputs in a language
     * only where it is present in that language's view — released there, in the released view (M27.2.1) — and its
     * path, pagination and scope come from that language's version of it.
     */
    private static List<PlanEntry> siteOutputs(
            Snapshot snapshot,
            PlanRequest request,
            Set<String> channels,
            TemplateCompileMemo memo,
            OutputPathResolver paths) {
        List<PlanEntry> outputs = new ArrayList<>();
        List<String> sortedChannels = channels.stream().sorted().toList();
        // A localized project fans out page × channel × language (M24.3.2); without locales the
        // single null language reproduces the pre-M24 plan entry for entry.
        com.acme.staticforge.project.LocaleConfig localeConfig =
                com.acme.staticforge.project.LocaleConfig.orEmpty(paths.locales());
        List<String> locales = localeConfig.isLocalized()
                ? localeConfig.codes()
                : java.util.Collections.singletonList(null);
        for (String locale : locales) {
            Snapshot view = snapshot.in(locale);
            SnapshotPagination pagination = SnapshotPagination.of(view, memo);
            List<SnapshotAsset> pages = view.pages().stream()
                    .filter(page -> inScope(page, request.scopeFolderPath(), request.scopeAssetUuids()))
                    .sorted(Comparator.comparing(page -> page.uuid().toString()))
                    .toList();
            for (SnapshotAsset page : pages) {
                Optional<PaginationValue> paginated = pagination.valueOf(page);
                PaginationSource.Result items = paginated.map(pagination::items).orElse(null);
                for (String channel : sortedChannels) {
                    // A project without locales takes the exact pre-M24 call, so its plan is
                    // produced by unchanged code rather than by a language-aware path that
                    // happens to agree.
                    String path = locale == null
                            ? paths.resolvePagePath(page.uuid(), channel)
                            : paths.resolvePagePath(page.uuid(), channel, locale);
                    if (paginated.isEmpty()) {
                        outputs.add(new PlanEntry(page.uuid(), channel, path, null, locale));
                        continue;
                    }
                    PaginatedPage paginatedPage =
                            paginatedPage(page.uuid(), channel, path, paginated.get(), items, paths, locale);
                    for (int number = 1; number <= paginatedPage.totalPages(); number++) {
                        outputs.add(new PlanEntry(
                                page.uuid(),
                                channel,
                                paginatedPage.path(number),
                                new PlanEntry.Pagination(number, paginatedPage),
                                locale));
                    }
                }
            }
        }
        outputs.sort(ENTRY_ORDER);
        return outputs;
    }

    /** Every page's path in {@code channel}: page 1 at the page's own path, pages 2..N by the pagination pattern. */
    private static PaginatedPage paginatedPage(
            UUID pageUuid,
            String channel,
            String firstPath,
            PaginationValue value,
            PaginationSource.Result items,
            OutputPathResolver paths,
            String locale) {
        int total = PaginationSource.totalPages(items.items().size(), value.pageSize());
        List<String> pagePaths = new ArrayList<>(total);
        pagePaths.add(firstPath);
        for (int number = 2; number <= total; number++) {
            pagePaths.add(locale == null
                    ? paths.resolvePaginationPath(pageUuid, channel, firstPath, number)
                    : paths.resolvePaginationPath(pageUuid, channel, firstPath, number, locale));
        }
        return new PaginatedPage(value.sourceUuid(), value.pageSize(), items.items(), pagePaths, items.warnings());
    }

    /**
     * Whether a page is in the request's scope: in the scope folder (or below) or listed in the scope assets. Without
     * either, every page is.
     */
    public static boolean inScope(SnapshotAsset page, String scopeFolderPath, Set<UUID> scopeAssetUuids) {
        boolean byFolder = scopeFolderPath != null && !scopeFolderPath.isBlank();
        boolean byAsset = scopeAssetUuids != null && !scopeAssetUuids.isEmpty();
        if (!byFolder && !byAsset) {
            return true;
        }
        if (byAsset && scopeAssetUuids.contains(page.uuid())) {
            return true;
        }
        if (!byFolder) {
            return false;
        }
        String folder = page.folderPath() == null ? "" : page.folderPath();
        String prefix = scopeFolderPath.endsWith("/") ? scopeFolderPath : scopeFolderPath + "/";
        return folder.equals(scopeFolderPath) || folder.startsWith(prefix);
    }

    // ------------------------------------------------------------------
    // Base build
    // ------------------------------------------------------------------

    private record OutputKey(UUID page, String channel, int pageNumber, String locale) {}

    private record OutputGroup(UUID page, String channel, String locale) {}

    private static Map<OutputKey, String> basePaths(BuildManifest manifest) {
        Map<OutputKey, String> paths = new HashMap<>();
        if (manifest != null) {
            for (BuildManifest.Output output : manifest.outputs()) {
                if (output.kind() == BuildManifest.Kind.PAGE && output.asset() != null) {
                    paths.put(new OutputKey(output.asset(), output.channel(), output.number(), output.locale()), output.path());
                }
            }
        }
        return paths;
    }

    /**
     * The assets whose registered URL changed since the base build (M32.5): with the URL registry deciding where outputs
     * go, an output lands elsewhere than in the base build only when its row was overridden, reset or imported — pages
     * and media whose paths differ from the manifest's, plus what the manifest can't show ({@link Baseline#urlChanged}).
     * Without a registry (a resolver computing every path) paths follow the content, and the walk sees moves as today.
     */
    private static Set<UUID> urlChanged(
            Snapshot snapshot,
            Baseline baseline,
            List<PlanEntry> site,
            Map<OutputKey, String> basePaths,
            OutputPathResolver paths) {
        Set<UUID> changed = new LinkedHashSet<>(baseline.urlChanged());
        if (paths.registry() == null || baseline.manifest() == null) {
            return changed;
        }
        for (PlanEntry output : site) {
            String base = basePaths.get(new OutputKey(output.pageUuid(), output.channel(), output.pageNumber(), output.locale()));
            if (base != null && !base.equals(output.outputPath())) {
                changed.add(output.pageUuid());
            }
        }
        Map<UUID, Set<String>> baseMedia = new LinkedHashMap<>();
        for (BuildManifest.Output output : baseline.manifest().outputs()) {
            if (output.kind() == BuildManifest.Kind.MEDIA && output.asset() != null) {
                baseMedia.computeIfAbsent(output.asset(), k -> new java.util.HashSet<>()).add(output.path());
            }
        }
        MediaOutputs media = new MediaOutputs(snapshot, paths.locales(), paths.registry());
        baseMedia.forEach((uuid, basePathsOfMedia) -> {
            Set<String> current = new java.util.HashSet<>();
            for (MediaOutputs.Output output : media.outputsOf(uuid)) {
                current.add(output.peekPath(null));
                variantNames(output.payload()).forEach(name -> {
                    String variant = output.peekPath(name);
                    if (variant != null) {
                        current.add(variant);
                    }
                });
            }
            if (!current.isEmpty() && !current.containsAll(basePathsOfMedia)) {
                changed.add(uuid);
            }
        });
        return changed;
    }

    private static List<String> variantNames(com.fasterxml.jackson.databind.JsonNode payload) {
        List<String> names = new ArrayList<>();
        com.fasterxml.jackson.databind.JsonNode variants = payload == null ? null : payload.get("variants");
        if (variants != null && variants.isArray()) {
            variants.forEach(variant -> {
                String name = variant.path("name").asText("");
                if (!name.isBlank()) {
                    names.add(name);
                }
            });
        }
        return names;
    }

    /** Page 1's path of every site page, per channel and language. */
    private static Map<UUID, Map<ChannelLocale, String>> firstPaths(List<PlanEntry> site) {
        Map<UUID, Map<ChannelLocale, String>> paths = new HashMap<>();
        for (PlanEntry output : site) {
            if (output.pageNumber() == 1) {
                paths.computeIfAbsent(output.pageUuid(), k -> new LinkedHashMap<>())
                        .put(new ChannelLocale(output.channel(), output.locale()), output.outputPath());
            }
        }
        return paths;
    }

    /** One channel in one language — what a page's path is keyed by once locales exist (M24.3.2). */
    private record ChannelLocale(String channel, String locale) {}

    /** Whether a page's output sits at another path than in the base build, in any channel/language both have. */
    private static boolean moved(
            UUID pageUuid, Map<UUID, Map<ChannelLocale, String>> firstPaths, Map<OutputKey, String> basePaths) {
        for (Map.Entry<ChannelLocale, String> path : firstPaths.getOrDefault(pageUuid, Map.of()).entrySet()) {
            String base = basePaths.get(
                    new OutputKey(pageUuid, path.getKey().channel(), 1, path.getKey().locale()));
            if (base != null && !base.equals(path.getValue())) {
                return true;
            }
        }
        return false;
    }
}
