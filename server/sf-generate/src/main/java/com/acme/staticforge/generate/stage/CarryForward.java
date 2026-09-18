package com.acme.staticforge.generate.stage;

import com.acme.staticforge.asset.AssetType;
import com.acme.staticforge.generate.pipeline.OutputFile;
import com.acme.staticforge.generate.pipeline.RenderedFile;
import com.acme.staticforge.generate.plan.BuildPlan;
import com.acme.staticforge.generate.plan.BuildPlanner;
import com.acme.staticforge.generate.plan.PlanEntry;
import com.acme.staticforge.generate.postprocess.SitePage;
import com.acme.staticforge.generate.snapshot.Snapshot;
import com.acme.staticforge.generate.snapshot.SnapshotAsset;
import com.acme.staticforge.generate.target.BuildManifest;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.IOException;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.Deque;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;

/**
 * What a run publishes (M22.4.1): its own files, and when it builds on a base build, the base build's outputs it keeps.
 *
 * <p>An incremental run renders only what changed, a scoped run only its scope. Both publish a whole site: the base
 * build's files, minus what went away, overlaid with what the run wrote. The rule is that a run publishes what a FULL
 * run with the same request would, except that a scoped run leaves everything outside its scope as the base build had
 * it. Concretely, a base output is kept when:
 * <ul>
 *   <li><b>a page output the run is responsible for</b> (its page is in the run's scope, its channel among the run's
 *       channels): the site still has that output at the same path and the run didn't plan it. A deleted or moved page,
 *       a shrunk pagination and a page the run planned but held back all drop the base file;</li>
 *   <li><b>any other page output</b>: only in a scoped run (an unscoped run's channels are the whole site);</li>
 *   <li><b>a media file</b>: some kept or rendered page, or a kept or rendered processed media file, still needs it, and
 *       the run didn't copy it again;</li>
 *   <li><b>a site file</b> (sitemap, search index…): never; post-processing writes them again for the whole site.</li>
 * </ul>
 *
 * <p>Each file of the new build is described in its {@link BuildManifest}; kept outputs keep their base entries.
 */
public final class CarryForward {

    private static final ObjectMapper JSON = new ObjectMapper();

    private final Snapshot snapshot;
    private final BuildPlan plan;
    private final Set<String> channels;
    private final boolean scoped;
    private final String scopeFolderPath;
    private final Set<UUID> scopeAssetUuids;
    private final BuildManifest base;
    private final Map<String, JsonNode> baseIndex;

    private final List<BuildManifest.Output> carriedPages = new ArrayList<>();

    /**
     * @param channels the channels the run planned
     * @param base the base build's manifest; {@code null} when the run publishes only its own files
     * @param baseSearchIndex the base build's {@code search-index.json}, when it has one
     */
    public CarryForward(
            Snapshot snapshot,
            BuildPlan plan,
            Set<String> channels,
            String scopeFolderPath,
            Set<UUID> scopeAssetUuids,
            BuildManifest base,
            Optional<byte[]> baseSearchIndex) {
        this.snapshot = snapshot;
        this.plan = plan;
        this.channels = Set.copyOf(channels);
        this.scopeFolderPath = scopeFolderPath;
        this.scopeAssetUuids = scopeAssetUuids;
        this.scoped = (scopeFolderPath != null && !scopeFolderPath.isBlank())
                || (scopeAssetUuids != null && !scopeAssetUuids.isEmpty());
        this.base = base;
        this.baseIndex = base == null ? Map.of() : searchIndex(baseSearchIndex);
        if (base != null) {
            selectCarriedPages();
        }
    }

    /** Whether the run builds on a base build. */
    public boolean carries() {
        return base != null;
    }

    public BuildManifest base() {
        return base;
    }

    // ------------------------------------------------------------------
    // Pages
    // ------------------------------------------------------------------

    /**
     * What identifies one page output. The language is part of it (M24.3.2): the German and the
     * English output of a page are two distinct files, and a run that rebuilds one must carry the
     * other forward rather than treat them as the same output.
     */
    private record OutputKey(UUID page, String channel, int pageNumber, String locale) {}

    private void selectCarriedPages() {
        Map<OutputKey, String> site = new HashMap<>();
        plan.siteOutputs().forEach(o ->
                site.put(new OutputKey(o.pageUuid(), o.channel(), o.pageNumber(), o.locale()), o.outputPath()));
        Set<OutputKey> planned = new HashSet<>();
        plan.entries().forEach(o ->
                planned.add(new OutputKey(o.pageUuid(), o.channel(), o.pageNumber(), o.locale())));

        for (BuildManifest.Output output : base.outputs()) {
            if (output.kind() != BuildManifest.Kind.PAGE) {
                continue;
            }
            OutputKey key = new OutputKey(output.asset(), output.channel(), output.number(), output.locale());
            boolean keep = responsibleFor(output)
                    ? output.path().equals(site.get(key)) && !planned.contains(key)
                    : scoped;
            if (keep) {
                carriedPages.add(output);
            }
        }
    }

    /** Whether the run decides about {@code output}: its page in scope (or no scope), its channel planned. */
    private boolean responsibleFor(BuildManifest.Output output) {
        if (!channels.contains(output.channel())) {
            return false;
        }
        SnapshotAsset page = output.asset() == null ? null : snapshot.assetByUuid(output.asset());
        return page == null || BuildPlanner.inScope(page, scopeFolderPath, scopeAssetUuids);
    }

    /**
     * The pages post-processing lists: every output of the site in the run's scope and channels, and in a scoped run
     * the kept outputs outside it (named as the base build's search index named them), in entry order.
     */
    public List<SitePage> sitePages() {
        List<SitePage> pages = new ArrayList<>();
        for (PlanEntry entry : plan.siteOutputs()) {
            SnapshotAsset page = snapshot.assetByUuid(entry.pageUuid());
            if (page != null) {
                pages.add(entry.pagination() == null
                        ? new SitePage(page.uid(), entry.outputPath(), entry.channel(), page.displayName(),
                                null, null, entry.locale())
                        : new SitePage(page.uid(), entry.outputPath(), entry.channel(), page.displayName(),
                                entry.pagination().pageNumber(), entry.pagination().totalPages()));
            }
        }
        for (BuildManifest.Output output : carriedPages) {
            if (!responsibleFor(output)) {
                pages.add(carriedSitePage(output));
            }
        }
        pages.sort(Comparator.comparing(SitePage::path)
                .thenComparing(page -> page.pageNumber() == null ? 1 : page.pageNumber()));
        return pages;
    }

    private SitePage carriedSitePage(BuildManifest.Output output) {
        JsonNode entry = baseIndex.get(output.path());
        SnapshotAsset page = output.asset() == null ? null : snapshot.assetByUuid(output.asset());
        String uid = entry != null ? entry.path("uid").asText("") : page == null ? "" : page.uid();
        String title = entry != null
                ? baseTitle(entry, output.pageNumber())
                : page == null ? "" : page.displayName();
        return new SitePage(uid, output.path(), output.channel(), title, output.pageNumber(), null, output.locale());
    }

    /** The base entry's title without the {@code " – page n"} suffix the search index adds again. */
    private static String baseTitle(JsonNode entry, Integer pageNumber) {
        String title = entry.path("title").asText("");
        String suffix = pageNumber != null && pageNumber > 1 ? " – page " + pageNumber : "";
        return !suffix.isEmpty() && title.endsWith(suffix) ? title.substring(0, title.length() - suffix.length()) : title;
    }

    /** The base build's search index text of every kept page output, by path. */
    public Map<String, String> carriedText() {
        Map<String, String> text = new HashMap<>();
        for (BuildManifest.Output output : carriedPages) {
            JsonNode entry = baseIndex.get(output.path());
            if (entry != null) {
                text.put(output.path(), entry.path("text").asText(""));
            }
        }
        return text;
    }

    // ------------------------------------------------------------------
    // Publication
    // ------------------------------------------------------------------

    /** What the writer stages and the manifest records. */
    public record Publication(List<OutputFile> files, Set<String> removedPaths, BuildManifest manifest) {}

    /**
     * The publication of a run.
     *
     * @param files every file the run wrote, after post-processing
     * @param rendered the run's rendered page files (their dependencies)
     * @param assets the run's copied and rendered media
     */
    public Publication publication(
            long runId, List<OutputFile> files, List<RenderedFile> rendered, AssetCopyResult assets) {
        Map<String, PlanEntry> entriesByPath = new HashMap<>();
        plan.entries().forEach(entry -> entriesByPath.put(entry.outputPath(), entry));
        Map<String, RenderedFile> renderedByPath = new HashMap<>();
        rendered.forEach(file -> renderedByPath.put(file.outputPath(), file));

        Map<String, BuildManifest.Output> outputs = new LinkedHashMap<>();
        Set<UUID> copiedMedia = new HashSet<>(assets.owners().values());
        List<BuildManifest.Output> kept = new ArrayList<>(carriedPages);
        kept.addAll(carriedMedia(copiedMedia, rendered, assets));
        kept.forEach(output -> outputs.put(output.path(), output));

        for (OutputFile file : files) {
            outputs.put(file.path(), describe(file, entriesByPath, renderedByPath, assets));
        }

        Set<String> removed = new HashSet<>();
        if (base != null) {
            for (BuildManifest.Output output : base.outputs()) {
                if (!outputs.containsKey(output.path())) {
                    removed.add(output.path());
                }
            }
        }

        long consistentRevision = scoped && base != null ? base.consistentRevision() : plan.revision();
        Set<String> complete = scoped ? (base == null ? Set.of() : base.completeChannels()) : channels;
        BuildManifest manifest = new BuildManifest(
                BuildManifest.VERSION, runId, plan.revision(), consistentRevision, complete, List.copyOf(outputs.values()));
        return new Publication(files, removed, manifest);
    }

    private BuildManifest.Output describe(
            OutputFile file,
            Map<String, PlanEntry> entriesByPath,
            Map<String, RenderedFile> renderedByPath,
            AssetCopyResult assets) {
        PlanEntry entry = entriesByPath.get(file.path());
        RenderedFile page = renderedByPath.get(file.path());
        if (entry != null && page != null) {
            return new BuildManifest.Output(
                    file.path(),
                    BuildManifest.Kind.PAGE,
                    entry.pageUuid(),
                    entry.channel(),
                    entry.pagination() == null ? null : entry.pageNumber(),
                    entry.locale(),
                    AssetCopyStage.mediaOnly(snapshot, page.dependencies()));
        }
        UUID media = assets.owners().get(file.path());
        if (media != null) {
            return new BuildManifest.Output(
                    file.path(), BuildManifest.Kind.MEDIA, media, null, null, assets.dependencies().get(media));
        }
        return new BuildManifest.Output(file.path(), BuildManifest.Kind.SITE, null, null, null, null);
    }

    /**
     * The base build's media outputs still needed and not copied again: the media the kept pages and every rendered
     * file depend on, closed over processed media (a stylesheet's images).
     */
    private List<BuildManifest.Output> carriedMedia(Set<UUID> copied, List<RenderedFile> rendered, AssetCopyResult assets) {
        if (base == null) {
            return List.of();
        }
        Map<UUID, List<BuildManifest.Output>> baseMedia = new HashMap<>();
        for (BuildManifest.Output output : base.outputs()) {
            if (output.kind() == BuildManifest.Kind.MEDIA && output.asset() != null) {
                baseMedia.computeIfAbsent(output.asset(), k -> new ArrayList<>()).add(output);
            }
        }
        Deque<UUID> pending = new ArrayDeque<>();
        carriedPages.forEach(output -> pending.addAll(output.dependencies()));
        rendered.forEach(file -> pending.addAll(AssetCopyStage.mediaOnly(snapshot, file.dependencies())));
        assets.dependencies().values().forEach(pending::addAll);

        Set<UUID> needed = new HashSet<>();
        List<BuildManifest.Output> carried = new ArrayList<>();
        while (!pending.isEmpty()) {
            UUID media = pending.poll();
            if (!needed.add(media) || copied.contains(media)) {
                continue;
            }
            SnapshotAsset asset = snapshot.assetByUuid(media);
            if (asset == null || asset.deleted() || asset.type() != AssetType.MEDIA) {
                continue;
            }
            for (BuildManifest.Output output : baseMedia.getOrDefault(media, List.of())) {
                carried.add(output);
                pending.addAll(output.dependencies());
            }
        }
        return carried;
    }

    private static Map<String, JsonNode> searchIndex(Optional<byte[]> bytes) {
        Map<String, JsonNode> byPath = new HashMap<>();
        if (bytes.isEmpty()) {
            return byPath;
        }
        try {
            JsonNode entries = JSON.readTree(bytes.get());
            if (entries != null && entries.isArray()) {
                entries.forEach(entry -> byPath.put(entry.path("path").asText(), entry));
            }
        } catch (IOException e) {
            // an unreadable index carries no text; the pages are still published and listed
        }
        return byPath;
    }
}
