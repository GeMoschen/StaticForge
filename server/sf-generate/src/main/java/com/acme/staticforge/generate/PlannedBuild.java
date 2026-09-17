package com.acme.staticforge.generate;

import com.acme.staticforge.generate.plan.BuildPlan;
import com.acme.staticforge.generate.render.OutputPathResolver;
import com.acme.staticforge.generate.snapshot.Snapshot;
import com.acme.staticforge.generate.target.BuildManifest;
import com.acme.staticforge.generate.target.TargetWriter;
import com.acme.staticforge.project.Project;
import java.util.Set;

/**
 * A planned build (M22.2.1): everything {@link GenerationService#planFor} decided for a request, shared by a real run
 * and a dry run so both plan exactly the same way.
 *
 * @param channels the channels planned
 * @param baseRunId the build the run carries forward, or {@code -1} when it publishes only its own files
 * @param base that build's manifest; {@code null} with {@code baseRunId == -1}
 */
public record PlannedBuild(
        Project project,
        GenerationTarget target,
        TargetWriter writer,
        Snapshot snapshot,
        OutputPathResolver paths,
        Set<String> channels,
        long baseRunId,
        BuildManifest base,
        BuildPlan plan) {

    public boolean carries() {
        return base != null;
    }
}
