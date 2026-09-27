package com.acme.staticforge.api;

import com.acme.staticforge.api.dto.CompactionEstimateView;
import com.acme.staticforge.api.dto.CompactionPolicyRequest;
import com.acme.staticforge.api.dto.CompactionPolicyView;
import com.acme.staticforge.housekeeping.HousekeepingProblems;
import com.acme.staticforge.project.Project;
import com.acme.staticforge.project.ProjectService;
import com.acme.staticforge.revision.compaction.CompactionPolicy;
import com.acme.staticforge.revision.compaction.CompactionPolicyService;
import com.acme.staticforge.revision.compaction.CompactionResult;
import com.acme.staticforge.revision.compaction.RevisionCompactor;
import com.acme.staticforge.security.SecuritySupport;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * A project's revision compaction (M29.4.1, spec §7.7, epic decision 13), for project admins. Compaction is opt-in
 * and removes old versions for good: enabling it, or lowering {@code olderThanDays}, needs {@code ?confirm=<project
 * key>} ({@code 422 SF-DOM-0182}); {@code olderThanDays} below 30 is {@code 422 SF-DOM-0183}. The setting is audited
 * ({@code COMPACTION_POLICY_SET}) and records no revision. The estimate is a dry run of the compaction.
 */
@RestController
@RequestMapping("/api/v1/projects/{projectKey}/compaction")
public class CompactionController {

    private final CompactionPolicyService policies;
    private final RevisionCompactor compactor;
    private final ProjectService projects;
    private final SecuritySupport securitySupport;
    private final Clock clock;

    public CompactionController(
            CompactionPolicyService policies,
            RevisionCompactor compactor,
            ProjectService projects,
            SecuritySupport securitySupport,
            Clock clock) {
        this.policies = policies;
        this.compactor = compactor;
        this.projects = projects;
        this.securitySupport = securitySupport;
        this.clock = clock;
    }

    @GetMapping
    @PreAuthorize("@projectAuth.has(#projectKey, " + ProjectRoleExpr.ADMIN + ")")
    public CompactionPolicyView get(@PathVariable String projectKey) {
        return view(policies.status(projectKey));
    }

    /**
     * Sets the policy. {@code confirm} must equal the project key when the request enables compaction or lowers
     * {@code olderThanDays}; an unchanged policy records nothing.
     */
    @PutMapping
    @PreAuthorize("@projectAuth.has(#projectKey, " + ProjectRoleExpr.ADMIN + ")")
    public CompactionPolicyView update(
            @PathVariable String projectKey,
            @RequestParam(value = "confirm", required = false) String confirm,
            @RequestBody CompactionPolicyRequest body) {
        policies.update(projectKey, body.enabled(), body.olderThanDays(), confirm, securitySupport.currentUserId());
        return view(policies.status(projectKey));
    }

    /**
     * What compacting now with {@code olderThanDays} would remove: a dry run of the compaction, which changes nothing
     * (so it is allowed on archived projects).
     */
    @AllowedOnArchivedProject("A dry run of the compaction: reads history, stores nothing.")
    @GetMapping("/estimate")
    @PreAuthorize("@projectAuth.has(#projectKey, " + ProjectRoleExpr.ADMIN + ")")
    public CompactionEstimateView estimate(
            @PathVariable String projectKey, @RequestParam("olderThanDays") int olderThanDays) {
        if (olderThanDays < CompactionPolicy.MIN_OLDER_THAN_DAYS) {
            throw HousekeepingProblems.compactionTooRecent(olderThanDays, CompactionPolicy.MIN_OLDER_THAN_DAYS);
        }
        Project project = projects.requireByKey(projectKey);
        Instant cutoff = clock.instant().minus(Duration.ofDays(olderThanDays));
        CompactionResult result = compactor.compact(project.getId(), cutoff, true, null);
        return new CompactionEstimateView(
                olderThanDays,
                cutoff,
                result.versionsInWindow(),
                result.versionsRemoved(),
                result.assetsTouched(),
                result.referencesRewritten(),
                result.revisionsMarked(),
                result.bytesFreed());
    }

    private static CompactionPolicyView view(CompactionPolicyService.CompactionStatus status) {
        CompactionPolicy policy = status.policy();
        CompactionPolicyService.LastRun run = status.lastRun();
        return new CompactionPolicyView(
                policy.enabled(),
                policy.olderThanDays(),
                policy.enabledAt(),
                policy.enabledBy(),
                status.compactedThrough(),
                run == null ? null : new CompactionPolicyView.LastRun(
                        run.runId(),
                        run.finishedAt(),
                        run.dryRun(),
                        run.outcome() == null ? null : run.outcome().name(),
                        run.cutoff(),
                        run.error(),
                        run.result().versionsInWindow(),
                        run.result().assetsTouched(),
                        run.result().versionsRemoved(),
                        run.result().referencesRewritten(),
                        run.result().revisionsMarked(),
                        run.result().bytesFreed()));
    }
}
