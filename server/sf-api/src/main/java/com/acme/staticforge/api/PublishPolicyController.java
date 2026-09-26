package com.acme.staticforge.api;

import com.acme.staticforge.api.dto.PublishPolicyImpactView;
import com.acme.staticforge.api.dto.PublishPolicyView;
import com.acme.staticforge.common.Problem;
import com.acme.staticforge.common.SfException;
import com.acme.staticforge.project.Project;
import com.acme.staticforge.project.ProjectService;
import com.acme.staticforge.project.publish.PublishPolicy;
import com.acme.staticforge.revision.RevisionContext;
import com.acme.staticforge.scheduler.ScheduleService;
import com.acme.staticforge.security.SecuritySupport;
import com.acme.staticforge.user.AppUser;
import com.acme.staticforge.user.UserService;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * The per-project publish policy (M28.1.1, spec §8.3): what editors may do to put content online. Every member reads
 * it; project admins change it. A change is a revision plus the audit action {@code PUBLISH_POLICY_SET} and applies to
 * every editor's next request (the policy is read per check, never carried in a token).
 */
@RestController
@RequestMapping("/api/v1/projects/{projectKey}/publish-policy")
public class PublishPolicyController {

    private final ProjectService projectService;
    private final ScheduleService scheduleService;
    private final UserService userService;
    private final SecuritySupport securitySupport;

    public PublishPolicyController(
            ProjectService projectService,
            ScheduleService scheduleService,
            UserService userService,
            SecuritySupport securitySupport) {
        this.projectService = projectService;
        this.scheduleService = scheduleService;
        this.userService = userService;
        this.securitySupport = securitySupport;
    }

    @GetMapping
    @PreAuthorize("@projectAuth.has(#projectKey, " + ProjectRoleExpr.VIEWER + ")")
    public PublishPolicyView get(@PathVariable String projectKey) {
        return view(projectService.publishPolicy(projectKey));
    }

    /**
     * Replaces the policy. {@code 400 SF-API-0400} with one message per unknown name or broken implication under
     * {@code errors}; an identical policy answers {@code 200} and records nothing.
     */
    @PutMapping
    @PreAuthorize("@projectAuth.can(#projectKey, 'ROLE:PROJECT_ADMIN')")
    public PublishPolicyView update(@PathVariable String projectKey, @RequestBody PublishPolicyView body) {
        Project project = projectService.requireByKey(projectKey);
        try {
            PublishPolicy saved = projectService.updatePublishPolicy(
                    projectKey,
                    PublishPolicy.parse(body.editor()),
                    RevisionContext.of(project.getId(), securitySupport.currentUserId(), null));
            return view(saved);
        } catch (PublishPolicy.InvalidPolicyException e) {
            throw invalid(e);
        }
    }

    /** The pending schedules the proposed policy would make fail; read-only, so allowed on archived projects. */
    @AllowedOnArchivedProject("A read-only impact check: evaluates a proposed policy, stores nothing.")
    @PostMapping("/impact")
    @PreAuthorize("@projectAuth.can(#projectKey, 'ROLE:PROJECT_ADMIN')")
    public PublishPolicyImpactView impact(@PathVariable String projectKey, @RequestBody PublishPolicyView body) {
        PublishPolicy proposed;
        try {
            proposed = PublishPolicy.parse(body.editor());
        } catch (PublishPolicy.InvalidPolicyException e) {
            throw invalid(e);
        }
        long projectId = projectService.requireByKey(projectKey).getId();
        List<ScheduleService.PolicyImpact> impact = scheduleService.policyImpact(projectId, proposed);
        Map<Long, AppUser> owners = userService.findAllById(impact.stream()
                .map(i -> i.action().getOwnerUserId())
                .filter(Objects::nonNull)
                .distinct()
                .toList());
        return new PublishPolicyImpactView(impact.stream()
                .map(i -> {
                    AppUser owner = owners.get(i.action().getOwnerUserId());
                    return new PublishPolicyImpactView.FailingSchedule(
                            i.action().getId(),
                            i.action().getType(),
                            i.action().getNextRunAt(),
                            i.action().getOwnerUserId(),
                            owner == null ? null : owner.getDisplayName(),
                            i.missing());
                })
                .toList());
    }

    private static PublishPolicyView view(PublishPolicy policy) {
        return new PublishPolicyView(policy.editor().stream().map(Enum::name).toList());
    }

    private static SfException invalid(PublishPolicy.InvalidPolicyException e) {
        return new SfException(Problem.builder()
                .type("https://cms.example.com/problems/sf-api-0400")
                .title("Bad Request")
                .status(400)
                .detail("The publish policy is invalid.")
                .property("code", "SF-API-0400")
                .property("errors", e.errors())
                .build());
    }
}
