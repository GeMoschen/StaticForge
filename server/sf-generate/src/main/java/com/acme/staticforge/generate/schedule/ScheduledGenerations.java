package com.acme.staticforge.generate.schedule;

import com.acme.staticforge.asset.AssetRepository;
import com.acme.staticforge.asset.AssetType;
import com.acme.staticforge.asset.AssetVersionRepository;
import com.acme.staticforge.channel.ChannelService;
import com.acme.staticforge.channel.OutputChannel;
import com.acme.staticforge.generate.GenerationRequest;
import com.acme.staticforge.generate.GenerationRun;
import com.acme.staticforge.generate.GenerationRunRepository;
import com.acme.staticforge.generate.GenerationService;
import com.acme.staticforge.generate.GenerationTargetRepository;
import com.acme.staticforge.project.Project;
import com.acme.staticforge.project.ProjectRepository;
import com.acme.staticforge.scheduler.ScheduledGenerationStarter;
import com.acme.staticforge.scheduler.SchedulerProblems;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Component;

/**
 * Starts the generation runs of scheduled actions (M27.4.2 "then generate", M27.4.3): checks the target, channels
 * and scope, reports a busy project instead of failing (epic decision 27), and starts the run through
 * {@link GenerationService#start} as the action's owner.
 *
 * <p>{@link GenerationService} is single-node (a JVM lock plus the database's active-run check): the scheduler's lease
 * makes sure only one node starts an action's run, but a scheduled start on one node can still race a manual start
 * on another. The loser gets {@code SF-GEN-0500} and the action waits for the winner — acceptable; distributed
 * generation is out of scope.
 */
@Component
public class ScheduledGenerations implements ScheduledGenerationStarter {

    private final GenerationService generationService;
    private final GenerationRunRepository runs;
    private final GenerationTargetRepository targets;
    private final ChannelService channels;
    private final ProjectRepository projects;
    private final AssetRepository assets;
    private final AssetVersionRepository versions;

    public ScheduledGenerations(
            GenerationService generationService,
            GenerationRunRepository runs,
            GenerationTargetRepository targets,
            ChannelService channels,
            ProjectRepository projects,
            AssetRepository assets,
            AssetVersionRepository versions) {
        this.generationService = generationService;
        this.runs = runs;
        this.targets = targets;
        this.channels = channels;
        this.projects = projects;
        this.assets = assets;
        this.versions = versions;
    }

    @Override
    public void validate(Order order) {
        targetProblem(order).ifPresent(message -> {
            throw SchedulerProblems.invalidParams(message, "targetId");
        });
        channelProblem(order).ifPresent(message -> {
            throw SchedulerProblems.invalidParams(message, "channels");
        });
        String folder = order.folderPath();
        if (folder != null && !folder.isBlank()) {
            String prefix = folder.endsWith("/") ? folder : folder + "/";
            String pattern = prefix.replace("!", "!!").replace("%", "!%").replace("_", "!_") + "%";
            boolean anyPage = versions.search(order.projectId(), AssetType.PAGE, null, pattern, PageRequest.of(0, 1))
                    .hasContent();
            if (!anyPage) {
                throw SchedulerProblems.invalidParams("No page lies in folder '" + folder + "'.", "scope.folderPath");
            }
        }
        if (!order.assetUuids().isEmpty()) {
            Set<UUID> found = assets.findByProjectIdAndUuidIn(order.projectId(), order.assetUuids()).stream()
                    .filter(a -> a.getAssetType() == AssetType.PAGE)
                    .map(a -> a.getUuid())
                    .collect(Collectors.toSet());
            Set<UUID> missing = new HashSet<>(order.assetUuids());
            missing.removeAll(found);
            if (!missing.isEmpty()) {
                throw SchedulerProblems.invalidParams("Unknown page(s) in the scope: " + missing + ".", "scope.assetUuids");
            }
        }
    }

    @Override
    public Start start(Order order) {
        Project project = projects.findById(order.projectId()).orElseThrow();
        Optional<GenerationRun> active = runs.findActive(order.projectId());
        if (active.isPresent()) {
            return new Busy(active.get().getId());
        }
        Optional<String> target = targetProblem(order);
        if (target.isPresent()) {
            return new Refused(SchedulerProblems.TARGET_GONE, target.get(), true);
        }
        Optional<String> channel = channelProblem(order);
        if (channel.isPresent()) {
            return new Refused(SchedulerProblems.INVALID_PARAMS, channel.get(), true);
        }
        GenerationRun run = generationService.start(
                project.getKey(),
                new GenerationRequest(
                        order.mode(),
                        order.revision(),
                        order.channels().isEmpty() ? null : order.channels(),
                        order.targetId(),
                        order.folderPath() == null || order.folderPath().isBlank() ? null : order.folderPath(),
                        order.assetUuids().isEmpty() ? null : order.assetUuids(),
                        order.comment(),
                        order.idempotencyKey()),
                order.userId(),
                order.scheduledActionId());
        return new Started(run.getId());
    }

    private Optional<String> targetProblem(Order order) {
        if (order.targetId() != null) {
            boolean exists = targets.findById(order.targetId())
                    .filter(t -> t.getProjectId() == order.projectId())
                    .isPresent();
            return exists ? Optional.empty() : Optional.of("Generation target " + order.targetId() + " doesn't exist.");
        }
        boolean any = targets.findByProjectIdAndDefaultTargetTrue(order.projectId()).isPresent()
                || !targets.findByProjectId(order.projectId()).isEmpty();
        return any ? Optional.empty() : Optional.of("The project has no generation target.");
    }

    private Optional<String> channelProblem(Order order) {
        if (order.channels().isEmpty()) {
            return Optional.empty();
        }
        Map<String, Boolean> enabled = channels.list(order.projectId()).stream()
                .collect(Collectors.toMap(OutputChannel::getKey, OutputChannel::isEnabled, (a, b) -> a));
        List<String> unusable = order.channels().stream().filter(c -> !Boolean.TRUE.equals(enabled.get(c))).toList();
        return unusable.isEmpty()
                ? Optional.empty()
                : Optional.of("Channel(s) not found or disabled: " + String.join(", ", unusable) + ".");
    }
}
