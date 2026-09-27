package com.acme.staticforge.generate.target;

import com.acme.staticforge.generate.GenerationTarget;
import com.acme.staticforge.generate.GenerationTargetRepository;
import com.acme.staticforge.project.Project;
import com.acme.staticforge.project.ProjectRepository;
import com.acme.staticforge.revision.compaction.RetainedBuildRevisions;
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
 * <p>The builds come from {@link TargetWriter#retainedRunIds()} (published builds on disk plus {@code current}), the
 * same listing {@code keep-builds} and run retention use, so compaction protects exactly the rollback points and
 * incremental baselines that exist.
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
        for (GenerationTarget target : targets.findByProjectId(projectId)) {
            TargetWriter writer = writers.forTarget(project.getKey(), target);
            long current = writer.currentRunId();
            for (long runId : writer.retainedRunIds()) {
                var manifest = writer.readManifest(runId);
                manifest.ifPresent(m -> {
                    revisions.add(m.revision());
                    revisions.add(m.consistentRevision());
                });
                if (manifest.isEmpty() && runId == current) {
                    jdbc.query("SELECT revision_id FROM generation_run WHERE id = ?",
                                    (rs, i) -> rs.getObject("revision_id", Long.class), runId)
                            .stream()
                            .filter(Objects::nonNull)
                            .forEach(revisions::add);
                }
            }
        }
        return revisions;
    }

}
