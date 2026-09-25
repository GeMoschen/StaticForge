package com.acme.staticforge;

import static org.assertj.core.api.Assertions.assertThat;

import com.acme.staticforge.channel.ChannelService;
import com.acme.staticforge.channel.OutputChannel;
import com.acme.staticforge.generate.GenerationMode;
import com.acme.staticforge.generate.pipeline.RenderedFile;
import com.acme.staticforge.generate.plan.BuildPlan;
import com.acme.staticforge.generate.plan.BuildPlanner;
import com.acme.staticforge.generate.plan.PlanRequest;
import com.acme.staticforge.generate.render.OutputPathResolver;
import com.acme.staticforge.generate.render.RenderOutcome;
import com.acme.staticforge.generate.render.RenderPipeline;
import com.acme.staticforge.generate.snapshot.Snapshot;
import com.acme.staticforge.generate.snapshot.SnapshotService;
import com.acme.staticforge.generate.snapshot.SnapshotView;
import com.acme.staticforge.project.ProjectLocales;
import com.acme.staticforge.project.ProjectService;
import com.acme.staticforge.release.ChangesService;
import com.acme.staticforge.release.ReleaseItem;
import com.acme.staticforge.release.ReleaseOutcome;
import com.acme.staticforge.release.ReleaseService;
import com.acme.staticforge.release.ReleaseStatus;
import com.acme.staticforge.revision.RevisionContext;
import java.nio.charset.StandardCharsets;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;
import org.springframework.stereotype.Component;

/**
 * Releases a fixture's pending content (M27.2.1). A build renders only released versions, so a test that saves content
 * and builds it releases first — the way an editor would press "Release" on everything the Changes view lists. Goes
 * through the real {@link ReleaseService} (one {@code RELEASE} revision, completeness gate included) as the system
 * user.
 *
 * <p>{@link ReleaseStatus#UNPUBLISHED} items are left alone: an explicit unpublish stays in force.
 *
 * <p><b>Golden check.</b> Whenever, after releasing, every language of the released view holds exactly the drafts —
 * the situation the initial-release migration creates — a full render of the released view must be byte-identical to
 * a render of the draft view, which is what generation rendered before M27 (epic exit criterion "a full build after
 * the migration is byte-identical"). Every generation test that releases its fixture therefore proves it on its own
 * fixture: with and without locales, paginated, record sets, navigation, media.
 */
@Component
public class ReleaseFixtures {

    private static final ChangesService.Query EVERYTHING = new ChangesService.Query(null, null, null, null, null, null, null);

    private final ChangesService changes;
    private final ReleaseService releases;
    private final ProjectService projects;
    private final SnapshotService snapshots;
    private final BuildPlanner planner;
    private final RenderPipeline pipeline;
    private final ChannelService channels;
    private final ProjectLocales locales;

    public ReleaseFixtures(
            ChangesService changes,
            ReleaseService releases,
            ProjectService projects,
            SnapshotService snapshots,
            BuildPlanner planner,
            RenderPipeline pipeline,
            ChannelService channels,
            ProjectLocales locales) {
        this.changes = changes;
        this.releases = releases;
        this.projects = projects;
        this.snapshots = snapshots;
        this.planner = planner;
        this.pipeline = pipeline;
        this.channels = channels;
        this.locales = locales;
    }

    /** As {@link #releaseAll(long)}, for the project with {@code projectKey}. */
    public Long releaseAll(String projectKey) {
        return releaseAll(projects.requireByKey(projectKey).getId());
    }

    /** Releases every new, changed and deletion-pending (asset, locale) of the project; the revision, or null. */
    public Long releaseAll(long projectId) {
        List<ReleaseItem> items = changes.list(projectId, EVERYTHING, 0, Integer.MAX_VALUE).rows().stream()
                .filter(row -> row.status() != ReleaseStatus.UNPUBLISHED)
                .map(row -> ReleaseItem.of(row.uuid(), row.locale()))
                .toList();
        Long revision = null;
        if (!items.isEmpty()) {
            ReleaseOutcome outcome = releases.release(items, RevisionContext.of(projectId, null, "test: release all"));
            revision = outcome.revision();
        }
        assertReleasedRendersLikeDrafts(projectId);
        return revision;
    }

    /** The golden check (see the class comment); a no-op while some language's release lags its drafts. */
    private void assertReleasedRendersLikeDrafts(long projectId) {
        Snapshot draft = snapshots.snapshot(projectId, null, SnapshotView.DRAFT);
        Snapshot released = snapshots.snapshot(projectId, null, SnapshotView.RELEASED);
        for (Snapshot view : released.views()) {
            if (!view.byUuid().equals(draft.byUuid())) {
                return;
            }
        }
        assertThat(render(projectId, released))
                .as("a released view equal to the drafts renders like the drafts (pre-M27 generation)")
                .isEqualTo(render(projectId, draft));
    }

    /** A full build of every enabled channel, rendered but not written: path → text, plus the diagnostics. */
    private Map<String, String> render(long projectId, Snapshot snapshot) {
        Set<String> enabled = new LinkedHashSet<>();
        for (OutputChannel channel : channels.list(projectId)) {
            if (channel.isEnabled()) {
                enabled.add(channel.getKey());
            }
        }
        Set<String> requested = BuildPlanner.effectiveChannels(enabled);
        OutputPathResolver paths =
                OutputPathResolver.forSnapshot(snapshot, channels.outputSettings(projectId), locales.forProject(projectId));
        Map<String, String> out = new TreeMap<>();
        try {
            BuildPlan plan = planner.plan(
                    snapshot, new PlanRequest(GenerationMode.FULL, null, null, requested, null, null), paths);
            RenderOutcome outcome = pipeline.execute(snapshot, plan, paths);
            for (RenderedFile file : outcome.files()) {
                out.put(file.outputPath(), new String(file.bytes(), StandardCharsets.UTF_8));
            }
            out.put("#errors", outcome.errors().toString());
            out.put("#warnings", outcome.warnings().toString());
            out.put("#pageErrors", outcome.pageErrors().toString());
        } catch (RuntimeException e) {
            out.put("#exception", e.getClass().getName() + ": " + e.getMessage());
        }
        return out;
    }
}
