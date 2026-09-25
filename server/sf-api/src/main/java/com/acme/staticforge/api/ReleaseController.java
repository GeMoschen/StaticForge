package com.acme.staticforge.api;

import com.acme.staticforge.api.dto.ReleasePlanView;
import com.acme.staticforge.api.dto.ReleaseRequest;
import com.acme.staticforge.api.dto.ReleaseResultView;
import com.acme.staticforge.api.dto.ReleaseTargetView;
import com.acme.staticforge.project.ProjectService;
import com.acme.staticforge.release.ReleaseItem;
import com.acme.staticforge.release.ReleaseOutcome;
import com.acme.staticforge.release.ReleasePlan;
import com.acme.staticforge.release.ReleaseService;
import com.acme.staticforge.release.ReleaseTarget;
import com.acme.staticforge.revision.RevisionContext;
import com.acme.staticforge.security.SecuritySupport;
import java.util.ArrayList;
import java.util.List;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * Release state changes (M27.1.3): the dependency-aware dry run, release, unpublish and discard. Each mutation is one
 * revision; the rules live in {@link ReleaseService}, the permission in {@code releasePermissions} (one method per
 * operation, so M28's publish policy changes one class).
 */
@RestController
@RequestMapping("/api/v1/projects/{projectKey}/releases")
public class ReleaseController {

    private final ProjectService projectService;
    private final ReleaseService releaseService;
    private final SecuritySupport securitySupport;

    public ReleaseController(ProjectService projectService, ReleaseService releaseService, SecuritySupport securitySupport) {
        this.projectService = projectService;
        this.releaseService = releaseService;
        this.securitySupport = securitySupport;
    }

    /** What releasing {@code items} would take along, and what blocks it. Writes nothing. */
    @PostMapping("/plan")
    @PreAuthorize("@projectAuth.has(#projectKey, " + ProjectRoleExpr.VIEWER + ")")
    @AllowedOnArchivedProject("dry run: computes a release plan, writes nothing")
    public ReleasePlanView plan(@PathVariable String projectKey, @RequestBody ReleaseRequest body) {
        ReleasePlan plan = releaseService.plan(projectId(projectKey), items(body.items()));
        return new ReleasePlanView(
                plan.items().stream().map(ReleaseController::view).toList(),
                plan.dependencies().stream()
                        .map(d -> new ReleasePlanView.Dependency(view(d.target()), d.reason().name(), d.via(), d.includedByDefault()))
                        .toList(),
                plan.incomplete().stream()
                        .map(i -> new ReleasePlanView.Incomplete(i.assetUuid(), i.locale(), i.issues()))
                        .toList(),
                plan.warnings());
    }

    /** Releases the selection and the kept dependencies, in one revision. */
    @PostMapping
    @PreAuthorize("@releasePermissions.canRelease(#projectKey)")
    public ReleaseResultView release(@PathVariable String projectKey, @RequestBody ReleaseRequest body) {
        List<ReleaseItem> items = new ArrayList<>(items(body.items()));
        items.addAll(items(body.includeDependencies()));
        return view(releaseService.release(items, ctx(projectKey, body.comment(), "release")));
    }

    /** Takes the selection offline; the drafts stay. */
    @PostMapping("/unpublish")
    @PreAuthorize("@releasePermissions.canUnpublish(#projectKey)")
    public ReleaseResultView unpublish(@PathVariable String projectKey, @RequestBody ReleaseRequest body) {
        return view(releaseService.unpublish(items(body.items()), ctx(projectKey, body.comment(), "unpublish")));
    }

    /** Writes the released versions of the selection back as its drafts. */
    @PostMapping("/discard")
    @PreAuthorize("@releasePermissions.canDiscard(#projectKey)")
    public ReleaseResultView discard(@PathVariable String projectKey, @RequestBody ReleaseRequest body) {
        return view(releaseService.discard(items(body.items()), ctx(projectKey, body.comment(), "discard changes")));
    }

    private static List<ReleaseItem> items(List<ReleaseRequest.Item> items) {
        if (items == null) {
            return List.of();
        }
        return items.stream().map(i -> i == null ? null : new ReleaseItem(i.assetUuid(), blankToNull(i.locale()), null)).toList();
    }

    private static String blankToNull(String locale) {
        return locale == null || locale.isBlank() ? null : locale;
    }

    private static ReleaseResultView view(ReleaseOutcome outcome) {
        return new ReleaseResultView(
                outcome.revision(),
                outcome.applied().stream().map(ReleaseController::view).toList(),
                outcome.skipped().stream().map(ReleaseController::view).toList(),
                outcome.sharedFieldsKept().stream().map(ReleaseController::view).toList());
    }

    static ReleaseTargetView view(ReleaseTarget t) {
        return new ReleaseTargetView(
                t.assetUuid(), t.type().name(), t.uid(), t.displayName(), t.locale(),
                t.status() == null ? null : t.status().name(), t.versionId());
    }

    private long projectId(String key) {
        return projectService.requireByKey(key).getId();
    }

    private RevisionContext ctx(String key, String comment, String fallback) {
        String text = comment == null || comment.isBlank() ? fallback : comment;
        return RevisionContext.of(projectId(key), securitySupport.currentUserId(), text);
    }
}
