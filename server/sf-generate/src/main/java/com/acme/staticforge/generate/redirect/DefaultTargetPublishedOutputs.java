package com.acme.staticforge.generate.redirect;

import com.acme.staticforge.generate.GenerationTarget;
import com.acme.staticforge.generate.GenerationTargetRepository;
import com.acme.staticforge.generate.target.TargetWriter;
import com.acme.staticforge.generate.target.TargetWriterSelector;
import com.acme.staticforge.project.Project;
import com.acme.staticforge.project.ProjectRepository;
import com.acme.staticforge.redirect.PublishedOutputs;
import java.util.Optional;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

/**
 * {@link PublishedOutputs} of the project's default target (M30.4.1): the target flagged default, else its only or
 * first target — the same choice a generation request without a target makes — and the manifest of the build its
 * {@code current} reference points at.
 */
@Component
public class DefaultTargetPublishedOutputs implements PublishedOutputs {

    private static final Logger LOG = LoggerFactory.getLogger(DefaultTargetPublishedOutputs.class);

    private final ProjectRepository projects;
    private final GenerationTargetRepository targets;
    private final TargetWriterSelector writers;

    public DefaultTargetPublishedOutputs(
            ProjectRepository projects, GenerationTargetRepository targets, TargetWriterSelector writers) {
        this.projects = projects;
        this.targets = targets;
        this.writers = writers;
    }

    @Override
    public Optional<PublishedBuild> current(long projectId) {
        Optional<Project> project = projects.findById(projectId);
        Optional<GenerationTarget> target = targets.findByProjectIdAndDefaultTargetTrue(projectId)
                .or(() -> targets.findByProjectId(projectId).stream().findFirst());
        if (project.isEmpty() || target.isEmpty()) {
            return Optional.empty();
        }
        try {
            TargetWriter writer = writers.forTarget(project.get().getKey(), target.get());
            long runId = writer.currentRunId();
            if (runId < 0) {
                return Optional.empty();
            }
            return writer.readManifest(runId)
                    .map(manifest -> new PublishedBuild(runId, ManifestRedirectOutputs.of(manifest)));
        } catch (RuntimeException e) {
            // An unreachable target is "nothing to compare with", not a failed registry read.
            LOG.warn("Could not read the current build of project {}'s default target: {}", projectId, e.toString());
            return Optional.empty();
        }
    }
}
