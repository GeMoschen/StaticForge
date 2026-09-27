package com.acme.staticforge.generate.cleanup;

import com.acme.staticforge.generate.GenerationProperties;
import com.acme.staticforge.generate.GenerationRunControl;
import com.acme.staticforge.generate.GenerationRunRepository;
import com.acme.staticforge.generate.GenerationRunRepository.RunState;
import com.acme.staticforge.generate.GenerationTarget;
import com.acme.staticforge.generate.GenerationTargetRepository;
import com.acme.staticforge.generate.RunStatus;
import com.acme.staticforge.generate.TargetLocations;
import com.acme.staticforge.generate.target.OrphanedTargetDirectories;
import com.acme.staticforge.generate.target.StoredItem;
import com.acme.staticforge.generate.target.TargetWriter;
import com.acme.staticforge.generate.target.TargetWriterSelector;
import com.acme.staticforge.housekeeping.HousekeepingJob;
import com.acme.staticforge.housekeeping.JobContext;
import com.acme.staticforge.housekeeping.JobDefaults;
import com.acme.staticforge.housekeeping.JobResult;
import com.acme.staticforge.housekeeping.SettingsSpec;
import com.acme.staticforge.project.Project;
import com.acme.staticforge.project.ProjectRepository;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.nio.file.Path;
import java.time.Duration;
import java.time.Instant;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

/**
 * {@code build-output-cleanup} (M29.2.2): removes generated output that no run will ever serve, for every project
 * (archived ones too) and target:
 *
 * <ul>
 *   <li>staged output of runs that ended {@code FAILED} or {@code CANCELLED} (recovery turns interrupted runs into
 *       {@code FAILED}): their build directory, {@code .zip.tmp} and manifest;
 *   <li>output of runs that have no row (deleted by retention), and staged archives of published runs, older than
 *       {@code minAge};
 *   <li>manifests whose build is gone;
 *   <li>{@code .current-*.link} files of an interrupted flip, older than {@code minAge};
 *   <li>directories under {@code {output-root}/{projectKey}/} that belong to no existing target (deleted targets, see
 *       {@link OrphanedTargetDirectories}), older than {@code minAge}.
 * </ul>
 *
 * Never removed: {@code current}, the build it points at, anything of a {@code QUEUED}/{@code RUNNING} run or of a run
 * this node executes, and published builds (their number is {@code keep-builds}' business). A dry run reports the same
 * paths and bytes and deletes nothing. The report has, per project, the items and bytes per target and the removed
 * target directories; the sample lists paths relative to the output root with the reason. Bytes are the directory walk
 * size: carried builds share hard-linked files, so the space actually freed can be smaller. S3 targets (a local-mirror
 * stub) are not cleaned.
 */
@Component
public class BuildOutputCleanupJob implements HousekeepingJob {

    public static final String KEY = "build-output-cleanup";

    private static final Logger log = LoggerFactory.getLogger(BuildOutputCleanupJob.class);

    static final SettingsSpec SETTINGS = SettingsSpec.builder()
            .duration("minAge", Duration.ZERO, null)
            .build();

    private final BuildOutputCleanupProperties properties;
    private final GenerationProperties generation;
    private final ProjectRepository projects;
    private final GenerationTargetRepository targets;
    private final GenerationRunRepository runs;
    private final TargetWriterSelector writers;
    private final GenerationRunControl control;

    public BuildOutputCleanupJob(
            BuildOutputCleanupProperties properties,
            GenerationProperties generation,
            ProjectRepository projects,
            GenerationTargetRepository targets,
            GenerationRunRepository runs,
            TargetWriterSelector writers,
            GenerationRunControl control) {
        this.properties = properties;
        this.generation = generation;
        this.projects = projects;
        this.targets = targets;
        this.runs = runs;
        this.writers = writers;
        this.control = control;
    }

    @Override
    public String key() {
        return KEY;
    }

    @Override
    public String displayName() {
        return "Build output cleanup";
    }

    @Override
    public String description() {
        return "Removes staged output of failed, cancelled and deleted runs, leftover temporary links and the output "
                + "folders of deleted targets. Published builds and the current build are kept.";
    }

    @Override
    public JobDefaults defaults() {
        return JobDefaults.of(properties, settings -> settings.put("minAge", properties.getMinAge().toString()));
    }

    @Override
    public List<String> validateSettings(JsonNode settings) {
        return SETTINGS.validate(settings);
    }

    @Override
    public boolean supportsDryRun() {
        return true;
    }

    @Override
    public JobResult run(JobContext ctx) {
        Instant olderThan = ctx.now().minus(ctx.settings().duration("minAge"));
        Path outputRoot = Path.of(generation.getOutputRoot()).toAbsolutePath().normalize();
        ObjectNode report = ctx.report().putObject("projects");
        List<Project> all = projects.findAll().stream().sorted(Comparator.comparing(Project::getKey)).toList();
        int failures = 0;
        for (int i = 0; i < all.size(); i++) {
            ctx.checkCancelled();
            Project project = all.get(i);
            ctx.progress("Project " + (i + 1) + " of " + all.size() + ": " + project.getKey());
            try {
                cleanProject(ctx, project, outputRoot, olderThan, report);
            } catch (RuntimeException e) {
                // One unreadable folder must not stop the others.
                failures++;
                log.warn("Build output cleanup of project {} failed", project.getKey(), e);
                report.withObject(project.getKey()).put("error", String.valueOf(e.getMessage()));
            }
        }
        String summary = (ctx.dryRun() ? "Would remove " : "Removed ") + ctx.affectedCount() + " item(s), "
                + ctx.bytesFreedCount() + " bytes.";
        return failures == 0
                ? JobResult.succeeded(summary)
                : JobResult.partial(summary + " " + failures + " project(s) failed; see the report.");
    }

    private void cleanProject(JobContext ctx, Project project, Path outputRoot, Instant olderThan, ObjectNode report) {
        Map<Long, RunStatus> states = new HashMap<>();
        for (RunState state : runs.findStatesByProjectId(project.getId())) {
            states.put(state.getId(), state.status());
        }
        List<GenerationTarget> projectTargets = targets.findByProjectId(project.getId());
        Set<String> owned = new HashSet<>();
        for (GenerationTarget target : projectTargets) {
            String relative = TargetLocations.relativePath(target);
            owned.add(relative);
            TargetWriter writer = writers.forTarget(project.getKey(), target);
            List<StoredItem> items = writer.storedItems();
            if (items.isEmpty()) {
                continue;
            }
            Set<Long> builds = new HashSet<>();
            items.stream().filter(item -> item.kind() == StoredItem.Kind.BUILD)
                    .forEach(item -> builds.add(item.runId()));
            long current = writer.currentRunId();
            long removed = 0;
            long bytes = 0;
            for (StoredItem item : items) {
                ctx.examined(1);
                String reason = removable(item, states, builds, current, olderThan);
                if (reason == null) {
                    continue;
                }
                long size = writer.sizeOf(item);
                if (!ctx.dryRun()) {
                    writer.delete(item);
                }
                removed++;
                bytes += size;
                ctx.affected(1);
                ctx.bytesFreed(size);
                ctx.sample(outputRoot.relativize(item.path()).toString().replace('\\', '/') + " (" + reason + ")");
            }
            if (removed > 0) {
                report.withObject(project.getKey()).withObject("targets").putObject(relative)
                        .put("removed", removed)
                        .put("bytes", bytes);
            }
        }
        for (Path orphan : OrphanedTargetDirectories.find(outputRoot, project.getKey(), owned, olderThan)) {
            ctx.examined(1);
            long size = OrphanedTargetDirectories.sizeOf(orphan);
            if (!ctx.dryRun()) {
                OrphanedTargetDirectories.delete(outputRoot, project.getKey(), orphan);
            }
            String path = outputRoot.relativize(orphan).toString().replace('\\', '/');
            ctx.affected(1);
            ctx.bytesFreed(size);
            ctx.sample(path + " (no target)");
            report.withObject(project.getKey()).withArray("deletedTargets").addObject()
                    .put("path", path)
                    .put("bytes", size);
        }
    }

    /** Why {@code item} goes, or {@code null} when it stays. */
    private String removable(StoredItem item, Map<Long, RunStatus> states, Set<Long> builds, long current, Instant olderThan) {
        boolean old = item.modified().isBefore(olderThan);
        if (item.kind() == StoredItem.Kind.TEMP_LINK) {
            return old ? "temporary link" : null;
        }
        long runId = item.runId();
        if (runId == current || control.isHeld(runId)) {
            return null;
        }
        RunStatus status = states.get(runId);
        if (status == null) {
            return old ? "no run" : null;
        }
        return switch (status) {
            case QUEUED, RUNNING -> null;
            case FAILED, CANCELLED -> status.name();
            case SUCCESS, PARTIAL -> switch (item.kind()) {
                case STAGED -> old ? "never published" : null;
                case MANIFEST -> builds.contains(runId) ? null : "manifest without build";
                case SIDECAR -> builds.contains(runId) ? null : "sidecar without build";
                default -> null;
            };
        };
    }
}
