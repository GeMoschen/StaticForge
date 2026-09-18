package com.acme.staticforge.generate.plan;

import com.acme.staticforge.asset.template.CompiledTemplateCache;
import com.acme.staticforge.generate.GenerationMode;
import com.acme.staticforge.generate.insight.FallbackCause;
import com.acme.staticforge.generate.insight.RebuildReason;
import com.acme.staticforge.generate.insight.RebuildRootKind;
import com.acme.staticforge.generate.render.OutputPathResolver;
import com.acme.staticforge.generate.render.SnapshotPagination;
import com.acme.staticforge.generate.snapshot.Snapshot;
import com.acme.staticforge.generate.snapshot.SnapshotAsset;
import com.acme.staticforge.generate.target.BuildManifest;
import com.acme.staticforge.pagination.PaginationSource;
import com.acme.staticforge.pagination.PaginationValue;
import com.fasterxml.jackson.databind.JsonNode;
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
    private final com.acme.staticforge.asset.AssetVersionRepository assetVersions;

    public BuildPlanner(
            CompiledTemplateCache compiledTemplates,
            RebuildExpansion expansion,
            com.acme.staticforge.asset.AssetVersionRepository assetVersions) {
        this.compiledTemplates = compiledTemplates;
        this.expansion = expansion;
        this.assetVersions = assetVersions;
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
        SnapshotPagination pagination = SnapshotPagination.of(snapshot, compiledTemplates.buildMemo(snapshot));
        List<PlanEntry> site = siteOutputs(snapshot, request, channels, pagination, paths);

        Baseline baseline = request.mode() == GenerationMode.INCREMENTAL ? request.baseline() : null;
        if (baseline == null) {
            return fullPlan(snapshot, request, site);
        }

        BuildManifest manifest = baseline.manifest();
        Map<OutputKey, String> basePaths = basePaths(manifest);
        Map<UUID, Map<ChannelLocale, String>> firstPaths = firstPaths(site);
        RebuildExpansion.Changes changes = expansion.changesSince(
                snapshot, baseline.revision(), pageUuid -> moved(pageUuid, firstPaths, basePaths));
        RebuildExpansion.Result walk = expansion.expand(snapshot, changes, pagination);

        Map<UUID, RebuildReason> reasons = new HashMap<>();
        // A page whose only change was a translation rebuilds just those languages (M24.3.2).
        Map<UUID, Set<String>> narrowed = localeNarrowing(snapshot, walk, baseline.revision(), paths);
        List<PlanEntry> entries = new ArrayList<>();
        Set<OutputGroup> missing = new LinkedHashSet<>();
        for (PlanEntry output : site) {
            UUID page = output.pageUuid();
            if (walk.reached(page)) {
                Set<String> only = narrowed.get(page);
                if (only != null && output.locale() != null && !only.contains(output.locale())) {
                    continue;
                }
                entries.add(output);
                reasons.computeIfAbsent(page, uuid -> only == null
                        ? walk.reasonFor(uuid)
                        : walk.reasonFor(uuid).narrowedTo(List.copyOf(only)));
            } else if (manifest != null
                    && !output.outputPath().equals(basePaths.get(new OutputKey(page, output.channel(), output.pageNumber(), output.locale())))) {
                missing.add(new OutputGroup(page, output.channel(), output.locale()));
            }
        }
        // An output the base build lacks is rendered with every other page number of its page in that channel.
        for (PlanEntry output : site) {
            OutputGroup group = new OutputGroup(output.pageUuid(), output.channel(), output.locale());
            if (missing.contains(group) && !walk.reached(output.pageUuid())) {
                entries.add(output);
                reasons.computeIfAbsent(output.pageUuid(), uuid -> ownRoot(snapshot, uuid, RebuildRootKind.NOT_IN_BASE_BUILD));
            }
        }
        for (UUID media : walk.processedMedia()) {
            reasons.put(media, walk.reasonFor(media));
        }
        entries.sort(ENTRY_ORDER);
        return new BuildPlan(
                true, snapshot.revision(), entries, walk.changedAssets(), walk.processedMedia(), site, reasons,
                walk.changeRevisions(), null, baseline.revision());
    }

    /**
     * For each page reached by its own change, the languages its change was confined to — absent
     * when the page must rebuild in every language (M24.3.2). Only pages that are their own rebuild
     * root qualify: a page reached over a dependency (a template, a media file, a global set) has no
     * payload difference of its own to narrow by.
     */
    private Map<UUID, Set<String>> localeNarrowing(
            Snapshot snapshot, RebuildExpansion.Result walk, long baselineRevision, OutputPathResolver paths) {
        if (!com.acme.staticforge.project.LocaleConfig.orEmpty(paths.locales()).isLocalized()) {
            return Map.of();
        }
        Map<UUID, Set<String>> narrowed = new HashMap<>();
        for (UUID pageUuid : walk.pages()) {
            RebuildReason reason = walk.reasonFor(pageUuid);
            if (reason == null || !reason.steps().isEmpty() || !pageUuid.equals(reason.rootUuid())) {
                continue; // reached over a dependency: its own payload says nothing about languages
            }
            SnapshotAsset page = snapshot.assetByUuid(pageUuid);
            if (page == null || page.deleted()) {
                continue;
            }
            JsonNode before = assetVersions
                    .findValidAtRevision(page.assetId(), baselineRevision)
                    .map(version -> version.isDeleted() ? null : version.getPayload())
                    .orElse(null);
            LocaleValueDiff.Result diff = LocaleValueDiff.compare(before, page.payload());
            if (diff.localeOnly()) {
                narrowed.put(pageUuid, diff.locales());
            }
        }
        return Map.copyOf(narrowed);
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
        SnapshotPagination pagination = SnapshotPagination.of(snapshot, compiledTemplates.buildMemo(snapshot));
        PlanRequest request = new PlanRequest(GenerationMode.FULL, null, null, channels, null, pages);
        return siteOutputs(snapshot, request, effectiveChannels(channels), pagination, paths);
    }

    // ------------------------------------------------------------------
    // Site outputs
    // ------------------------------------------------------------------

    private static final Comparator<PlanEntry> ENTRY_ORDER = Comparator.comparing(PlanEntry::outputPath)
            .thenComparingInt(PlanEntry::pageNumber)
            .thenComparing(PlanEntry::pageUuid)
            // The language is null in a project without locales, so order it explicitly.
            .thenComparing(PlanEntry::locale, Comparator.nullsFirst(Comparator.naturalOrder()));

    /** Every output of every live page in scope, in every channel, in entry order. */
    private static List<PlanEntry> siteOutputs(
            Snapshot snapshot,
            PlanRequest request,
            Set<String> channels,
            SnapshotPagination pagination,
            OutputPathResolver paths) {
        List<PlanEntry> outputs = new ArrayList<>();
        List<SnapshotAsset> pages = snapshot.pages().stream()
                .filter(page -> inScope(page, request.scopeFolderPath(), request.scopeAssetUuids()))
                .sorted(Comparator.comparing(page -> page.uuid().toString()))
                .toList();
        List<String> sortedChannels = channels.stream().sorted().toList();
        // A localized project fans out page × channel × language (M24.3.2); without locales the
        // single null language reproduces the pre-M24 plan entry for entry.
        com.acme.staticforge.project.LocaleConfig localeConfig =
                com.acme.staticforge.project.LocaleConfig.orEmpty(paths.locales());
        List<String> locales = localeConfig.isLocalized()
                ? localeConfig.codes()
                : java.util.Collections.singletonList(null);
        for (SnapshotAsset page : pages) {
            Optional<PaginationValue> paginated = pagination.valueOf(page);
            PaginationSource.Result items = paginated.map(pagination::items).orElse(null);
            for (String channel : sortedChannels) {
                for (String locale : locales) {
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
