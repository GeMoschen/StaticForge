package com.acme.staticforge.generate;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.acme.staticforge.asset.AssetRepository;
import com.acme.staticforge.asset.AssetVersionRepository;
import com.acme.staticforge.channel.ChannelService;
import com.acme.staticforge.generate.schedule.ScheduledGenerations;
import com.acme.staticforge.project.Project;
import com.acme.staticforge.project.ProjectRepository;
import com.acme.staticforge.scheduler.ScheduledGenerationStarter;
import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

/** A run the scheduler starts is a {@code SCHEDULE} run (M35.24), whatever its owner could send through the API. */
class ScheduledGenerationsTriggerTest {

    @Test
    void theSchedulerStartsScheduleRuns() {
        GenerationService service = mock(GenerationService.class);
        GenerationRunRepository runs = mock(GenerationRunRepository.class);
        GenerationTargetRepository targets = mock(GenerationTargetRepository.class);
        ProjectRepository projects = mock(ProjectRepository.class);
        Project project = mock(Project.class);
        when(project.getKey()).thenReturn("p");
        when(projects.findById(1L)).thenReturn(Optional.of(project));
        when(runs.findActive(1L)).thenReturn(Optional.empty());
        when(targets.findByProjectIdAndDefaultTargetTrue(1L)).thenReturn(Optional.of(mock(GenerationTarget.class)));
        GenerationRun started = mock(GenerationRun.class);
        when(started.getId()).thenReturn(5L);
        when(service.start(any(), any(), anyLong(), any())).thenReturn(started);

        ScheduledGenerations scheduled = new ScheduledGenerations(service, runs, targets, mock(ChannelService.class),
                projects, mock(AssetRepository.class), mock(AssetVersionRepository.class));
        ScheduledGenerationStarter.Start result = scheduled.start(new ScheduledGenerationStarter.Order(
                1L, GenerationMode.INCREMENTAL, null, null, List.of(), null, List.of(), "Scheduled generation #1", 2L,
                "key", 3L));

        assertThat(result).isInstanceOf(ScheduledGenerationStarter.Started.class);
        ArgumentCaptor<GenerationRequest> request = ArgumentCaptor.forClass(GenerationRequest.class);
        verify(service).start(any(), request.capture(), anyLong(), any());
        assertThat(request.getValue().trigger()).isEqualTo(GenerationTrigger.SCHEDULE);
    }
}
