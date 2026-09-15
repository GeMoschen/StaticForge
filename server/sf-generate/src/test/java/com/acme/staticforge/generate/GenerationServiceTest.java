package com.acme.staticforge.generate;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.acme.staticforge.asset.AssetReferenceRepository;
import com.acme.staticforge.asset.content.ContentReferenceService;
import com.acme.staticforge.channel.ChannelService;
import com.acme.staticforge.common.SfException;
import com.acme.staticforge.generate.plan.BuildPlanner;
import com.acme.staticforge.generate.render.RenderPipeline;
import com.acme.staticforge.generate.snapshot.SnapshotService;
import com.acme.staticforge.generate.stage.AssetCopyStage;
import com.acme.staticforge.generate.stage.PostProcessStage;
import com.acme.staticforge.generate.target.TargetWriter;
import com.acme.staticforge.generate.target.TargetWriterSelector;
import com.acme.staticforge.project.Project;
import com.acme.staticforge.project.ProjectService;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/**
 * Generation orchestration unit tests: the one-active-run 409 conflict, idempotent re-submission,
 * and synchronous cancel/promote. The full pipeline execution is covered by
 * {@code GenerationIntegrationTest} in {@code sf-app}.
 */
class GenerationServiceTest {

    private GenerationRunRepository runs;
    private GenerationTargetRepository targets;
    private ProjectService projects;
    private SnapshotService snapshots;
    private BuildPlanner planner;
    private RenderPipeline renderer;
    private AssetCopyStage assetsStage;
    private PostProcessStage postStage;
    private TargetWriterSelector writers;
    private ContentReferenceService contentRefs;
    private AssetReferenceRepository assetRefs;

    private GenerationService service;

    @BeforeEach
    void setUp() {
        runs = mock(GenerationRunRepository.class);
        targets = mock(GenerationTargetRepository.class);
        projects = mock(ProjectService.class);
        snapshots = mock(SnapshotService.class);
        planner = mock(BuildPlanner.class);
        renderer = mock(RenderPipeline.class);
        assetsStage = mock(AssetCopyStage.class);
        postStage = mock(PostProcessStage.class);
        writers = mock(TargetWriterSelector.class);
        contentRefs = mock(ContentReferenceService.class);
        assetRefs = mock(AssetReferenceRepository.class);
        service = new GenerationService(runs, targets, projects, mock(ChannelService.class), snapshots, planner, renderer, assetsStage, postStage,
                writers, contentRefs, assetRefs, new ObjectMapper(), new SimpleMeterRegistry());

        Project project = project(1L);
        when(projects.requireByKey("p")).thenReturn(project);
        lenient().when(runs.findById(any())).thenReturn(Optional.empty());
    }

    @Test
    void startRejectsWhenAnotherRunIsActive() {
        GenerationRun active = run(99L, RunStatus.RUNNING);
        when(runs.findActive(1L)).thenReturn(Optional.of(active));

        assertThatThrownBy(() -> service.start("p", request(null, null), 7L))
                .isInstanceOf(SfException.class)
                .satisfies(e -> {
                    assertThat(((SfException) e).getStatus()).isEqualTo(409);
                    assertThat(((SfException) e).getProblem().getDetail()).contains("already running");
                });

        verify(runs, never()).saveAndFlush(any());
    }

    @Test
    void startHonoursIdempotencyKeyByNotSpawningASecondRun() {
        GenerationRun saved = run(5L, RunStatus.QUEUED);
        when(runs.findActive(1L)).thenReturn(Optional.empty());
        when(runs.saveAndFlush(any())).thenReturn(saved);

        String key = "idem-123";
        GenerationRun first = service.start("p", request(null, key), 7L);
        GenerationRun second = service.start("p", request(null, key), 7L);

        assertThat(first).isSameAs(saved);
        verify(runs).saveAndFlush(any());
    }

    @Test
    void cancelMarksRunningRunCancelled() {
        GenerationRun run = run(5L, RunStatus.RUNNING);
        when(runs.findById(5L)).thenReturn(Optional.of(run));
        when(runs.save(run)).thenReturn(run);

        GenerationRun result = service.cancel("p", 5L);

        verify(run).setStatus(RunStatus.CANCELLED);
        verify(run).setFinishedAt(any());
        verify(runs).save(run);
        assertThat(result).isSameAs(run);
    }

    @Test
    void promoteDelegatesToTheTargetWriter() {
        GenerationRun run = run(5L, RunStatus.SUCCESS);
        GenerationTarget target = target(9L);
        TargetWriter writer = mock(TargetWriter.class);
        when(runs.findById(5L)).thenReturn(Optional.of(run));
        when(targets.findByProjectIdAndDefaultTargetTrue(anyLong())).thenReturn(Optional.of(target));
        when(writers.forTarget("p", target)).thenReturn(writer);

        service.promote("p", 5L);

        verify(writer).promote(5L);
    }

    private static GenerationRequest request(Long targetId, String idempotencyKey) {
        return new GenerationRequest(GenerationMode.FULL, null, List.of("html"), targetId, null, null, null,
                idempotencyKey);
    }

    private static GenerationRun run(long id, RunStatus status) {
        GenerationRun run = mock(GenerationRun.class);
        lenient().when(run.getId()).thenReturn(id);
        lenient().when(run.getProjectId()).thenReturn(1L);
        lenient().when(run.getStatus()).thenReturn(status);
        lenient().when(run.getTargetId()).thenReturn(null);
        return run;
    }

    private static Project project(long id) {
        Project project = mock(Project.class);
        when(project.getId()).thenReturn(id);
        return project;
    }

    private static GenerationTarget target(long id) {
        GenerationTarget target = mock(GenerationTarget.class);
        lenient().when(target.getId()).thenReturn(id);
        lenient().when(target.getProjectId()).thenReturn(1L);
        lenient().when(target.getType()).thenReturn(TargetType.FILESYSTEM);
        return target;
    }
}
