package com.acme.staticforge.generate;

import com.acme.staticforge.asset.AssetType;
import com.acme.staticforge.asset.media.MediaPaths;
import com.acme.staticforge.asset.template.CompiledTemplateCache;
import com.acme.staticforge.channel.ChannelService;
import com.acme.staticforge.channel.OutputChannel;
import com.acme.staticforge.common.ProblemFactory;
import com.acme.staticforge.common.SfException;
import com.acme.staticforge.generate.insight.PlanEntryRecord;
import com.acme.staticforge.generate.insight.RebuildReason;
import com.acme.staticforge.generate.plan.BuildPlanner;
import com.acme.staticforge.generate.plan.PlanEntry;
import com.acme.staticforge.generate.plan.RebuildExpansion;
import com.acme.staticforge.generate.render.OutputPathResolver;
import com.acme.staticforge.generate.render.SnapshotPagination;
import com.acme.staticforge.generate.snapshot.Snapshot;
import com.acme.staticforge.generate.snapshot.SnapshotAsset;
import com.acme.staticforge.generate.snapshot.SnapshotService;
import com.acme.staticforge.project.Project;
import com.acme.staticforge.project.ProjectService;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;
import java.util.UUID;
import org.springframework.stereotype.Service;

/**
 * What would rebuild if an asset changed (M22.2.2): the asset as a changed root of the planner's own walk
 * ({@link RebuildExpansion}, with {@link RebuildExpansion.Changes#upperBound} changes) over the current state, expanded to
 * the outputs generation would write. An upper bound: a real edit rebuilds the same entries or fewer.
 */
@Service
public class ImpactService {

    private final ProjectService projectService;
    private final ChannelService channelService;
    private final SnapshotService snapshotService;
    private final BuildPlanner buildPlanner;
    private final RebuildExpansion expansion;
    private final CompiledTemplateCache compiledTemplates;

    public ImpactService(
            ProjectService projectService,
            ChannelService channelService,
            SnapshotService snapshotService,
            BuildPlanner buildPlanner,
            RebuildExpansion expansion,
            CompiledTemplateCache compiledTemplates) {
        this.projectService = projectService;
        this.channelService = channelService;
        this.snapshotService = snapshotService;
        this.buildPlanner = buildPlanner;
        this.expansion = expansion;
        this.compiledTemplates = compiledTemplates;
    }

    /**
     * The impact of an asset.
     *
     * @param revision the current revision the impact was computed at
     * @param entries every output that would rebuild with its chain back to the asset: pages, then processed media
     * @param pageCount the number of distinct pages among the entries
     * @param byFirstEdge entry counts by the first edge of their chain ({@code NONE} for the asset itself)
     */
    public record Impact(
            SnapshotAsset asset, long revision, List<PlanEntryRecord> entries, int pageCount, Map<String, Integer> byFirstEdge) {}

    /**
     * @param channel only this channel; {@code null} for every enabled channel of the project
     * @throws SfException 404 when the asset doesn't exist in the project or is deleted
     */
    public Impact impact(String projectKey, UUID assetUuid, String channel) {
        Project project = projectService.requireByKey(projectKey);
        Snapshot snapshot = snapshotService.snapshot(project.getId(), null);
        SnapshotAsset asset = assetUuid == null ? null : snapshot.assetByUuid(assetUuid);
        if (asset == null || asset.deleted()) {
            throw new SfException(ProblemFactory.notFound("Asset not found."));
        }

        RebuildExpansion.Result walk = expansion.expand(
                snapshot,
                RebuildExpansion.Changes.upperBound(asset.assetId()),
                SnapshotPagination.of(snapshot, compiledTemplates.buildMemo(snapshot)));
        OutputPathResolver paths = OutputPathResolver.forSnapshot(snapshot, channelService.outputSettings(project.getId()));
        Set<UUID> pages = new LinkedHashSet<>();
        for (UUID page : walk.pages()) {
            SnapshotAsset reached = snapshot.assetByUuid(page);
            if (reached != null && !reached.deleted()) {
                pages.add(page);
            }
        }

        List<PlanEntryRecord> entries = new ArrayList<>();
        for (PlanEntry output : buildPlanner.outputsOf(snapshot, pages, channels(project.getId(), channel), paths)) {
            SnapshotAsset page = snapshot.assetByUuid(output.pageUuid());
            entries.add(new PlanEntryRecord(page.uuid(), page.type().name(), page.uid(), page.displayName(), output.channel(),
                    output.outputPath(), output.pagination() == null ? null : output.pageNumber(),
                    walk.reasonFor(page.uuid())));
        }
        if (channel == null) {
            walk.processedMedia().stream()
                    .map(snapshot::assetByUuid)
                    .sorted(Comparator.comparing(SnapshotAsset::uid))
                    .forEach(media -> {
                        String mimeType = media.payload() == null ? null : media.payload().path("mimeType").asText(null);
                        entries.add(new PlanEntryRecord(media.uuid(), AssetType.MEDIA.name(), media.uid(), media.displayName(),
                                null, MediaPaths.mediaPath(media.uid(), MediaPaths.extensionFor(mimeType)), null,
                                walk.reasonFor(media.uuid())));
                    });
        }

        Map<String, Integer> byFirstEdge = new TreeMap<>();
        for (PlanEntryRecord entry : entries) {
            RebuildReason reason = entry.reason();
            byFirstEdge.merge(reason.firstEdge() == null ? "NONE" : reason.firstEdge().name(), 1, Integer::sum);
        }
        return new Impact(asset, snapshot.revision(), entries, pages.size(), byFirstEdge);
    }

    /** {@code channel}, or the project's enabled channels (the default channel when it has none). */
    private Set<String> channels(long projectId, String channel) {
        if (channel != null && !channel.isBlank()) {
            return Set.of(channel);
        }
        Set<String> enabled = new LinkedHashSet<>();
        for (OutputChannel output : channelService.list(projectId)) {
            if (output.isEnabled()) {
                enabled.add(output.getKey());
            }
        }
        return BuildPlanner.effectiveChannels(enabled);
    }
}
