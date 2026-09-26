package com.acme.staticforge.generate;

import com.acme.staticforge.project.ProjectRole;
import com.acme.staticforge.project.publish.PublishPermission;
import com.acme.staticforge.project.publish.PublishRequirements;
import java.util.Objects;
import org.springframework.stereotype.Component;

/**
 * What starting a generation run needs (M28.2.2, epic decision 7) — one rule for the generation endpoints (start and
 * dry run), a scheduled release's "then generate" step and the matrix test:
 *
 * <ul>
 *   <li>a pinned {@code revision} (rendering the past is rollback-like): {@code DEVELOPER}, whatever the policy;
 *   <li>an explicit {@code INCREMENTAL} run to the target an absent {@code targetId} resolves to (the default target,
 *       else the first): {@link PublishPermission#INCREMENTAL_BUILD}, scoped or not;
 *   <li>anything else — a missing mode is a full run — or another target: {@link PublishPermission#FULL_BUILD}.
 * </ul>
 *
 * <p>An incremental request the planner turns into a full plan ({@code fallbackCause}) still needs only
 * {@code INCREMENTAL_BUILD}: the fallback is the system's decision. A target id of another project needs
 * {@code FULL_BUILD} like any other non-default id, so the answer reveals nothing; starting then fails as before.
 */
@Component
public class GenerationAuthorization {

    private final GenerationTargetRepository targets;

    public GenerationAuthorization(GenerationTargetRepository targets) {
        this.targets = targets;
    }

    /**
     * The requirements of a run of {@code projectId}.
     *
     * @param mode {@code null} means {@link GenerationMode#FULL}, as for a start
     * @param targetId {@code null} for the default target
     * @param revision {@code null} for the current revision
     */
    public PublishRequirements requiredFor(long projectId, GenerationMode mode, Long targetId, Long revision) {
        if (revision != null) {
            return PublishRequirements.role(ProjectRole.DEVELOPER);
        }
        if (mode != GenerationMode.INCREMENTAL || !isDefaultTarget(projectId, targetId)) {
            return PublishRequirements.permission(PublishPermission.FULL_BUILD);
        }
        return PublishRequirements.permission(PublishPermission.INCREMENTAL_BUILD);
    }

    /** Whether {@code targetId} is where a run without one goes (the same order as the generation service). */
    public boolean isDefaultTarget(long projectId, Long targetId) {
        if (targetId == null) {
            return true;
        }
        Long resolved = targets.findByProjectIdAndDefaultTargetTrue(projectId)
                .or(() -> targets.findByProjectId(projectId).stream().findFirst())
                .map(GenerationTarget::getId)
                .orElse(null);
        return Objects.equals(resolved, targetId);
    }
}
