package com.acme.staticforge.generate.target;

import com.acme.staticforge.generate.GenerationTarget;
import com.acme.staticforge.generate.GenerationTargetRepository;
import com.acme.staticforge.project.Project;
import com.acme.staticforge.project.ProjectRepository;
import com.acme.staticforge.revision.compaction.RetainedBuildRevisions;
import java.util.List;
import java.util.Objects;
import java.util.Set;
import java.util.TreeSet;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

/**
 * {@link RetainedBuildRevisions} from the target writers (M29.4.2): for every target of the project, every run of that
 * target whose build is still on disk — its manifest can be read — contributes the manifest's revision and consistent
 * revision. The run a target's {@code current} points at contributes its revision even without a manifest (builds
 * from before M22 have none), so the live site is always covered.
 *
 * <p>Runs are listed from {@code generation_run} and each is probed with {@link TargetWriter#readManifest}; a run
 * without a target id belongs to the project's default target. Probing more runs than are on disk only costs file
 * checks; a manifest is never missed because of a status, so a failed run's leftover build counts too (protecting more
 * is always safe).
 */
@Service
public class TargetRetainedBuildRevisions implements RetainedBuildRevisions {

    private final ProjectRepository projects;
    private final GenerationTargetRepository targets;
    private final TargetWriterSelector writers;
    private final JdbcTemplate jdbc;

    public TargetRetainedBuildRevisions(
            ProjectRepository projects,
            GenerationTargetRepository targets,
            TargetWriterSelector writers,
            JdbcTemplate jdbc) {
        this.projects = projects;
        this.targets = targets;
        this.writers = writers;
        this.jdbc = jdbc;
    }

    @Override
    public Set<Long> revisionsFor(long projectId) {
        Set<Long> revisions = new TreeSet<>();
        Project project = projects.findById(projectId).orElse(null);
        if (project == null) {
            return revisions;
        }
        List<RunRow> runs = jdbc.query(
                "SELECT id, target_id, revision_id FROM generation_run WHERE project_id = ?",
                (rs, i) -> new RunRow(
                        rs.getLong("id"), rs.getObject("target_id", Long.class), rs.getObject("revision_id", Long.class)),
                projectId);
        for (GenerationTarget target : targets.findByProjectId(projectId)) {
            TargetWriter writer = writers.forTarget(project.getKey(), target);
            long current = writer.currentRunId();
            for (RunRow run : runs) {
                boolean ofTarget = run.targetId() == null ? target.isDefaultTarget() : Objects.equals(run.targetId(), target.getId());
                if (!ofTarget) {
                    continue;
                }
                writer.readManifest(run.id()).ifPresent(manifest -> {
                    revisions.add(manifest.revision());
                    revisions.add(manifest.consistentRevision());
                });
                if (run.id() == current && run.revisionId() != null) {
                    revisions.add(run.revisionId());
                }
            }
        }
        return revisions;
    }

    private record RunRow(long id, Long targetId, Long revisionId) {}
}
