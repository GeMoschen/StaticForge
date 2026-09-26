package com.acme.staticforge.project.publish;

import com.acme.staticforge.project.ProjectMember;
import com.acme.staticforge.project.ProjectMemberRepository;
import com.acme.staticforge.project.ProjectRepository;
import com.acme.staticforge.project.ProjectRole;
import com.acme.staticforge.user.AppUser;
import com.acme.staticforge.user.SystemRole;
import com.acme.staticforge.user.UserService;
import com.acme.staticforge.user.UserStatus;
import java.util.Optional;
import org.springframework.stereotype.Component;

/**
 * Evaluates {@link PublishRequirements} for a stored user (M28, epic decision 5): the role comes from the membership
 * row and the policy from the project row, both read on every call. Used where there is no token — the scheduler,
 * before every execution and when a schedule is saved, and the release service for whoever acts. The request-side
 * twin ({@code ProjectAuthorizationService}) reads the role from the token; both decide through
 * {@link PublishRequirements#missing}, i.e. {@link PublishPolicy#grants}.
 *
 * <p>A disabled or deleted account holds nothing. A temporary sign-in lockout ({@code LOCKED}) doesn't revoke what the
 * account may do (M27.4.1: an owner's scheduled release still runs). An instance admin holds everything without
 * membership.
 */
@Component
public class PublishPermissionEvaluator {

    private final UserService users;
    private final ProjectMemberRepository members;
    private final ProjectRepository projects;

    public PublishPermissionEvaluator(UserService users, ProjectMemberRepository members, ProjectRepository projects) {
        this.users = users;
        this.members = members;
        this.projects = projects;
    }

    /**
     * Why a user may not do something.
     *
     * @param reason a sentence fragment for messages ("the account 'bob' is disabled")
     * @param missing what the user lacks — a permission name or {@code "ROLE:<minimum>"} — or {@code null} when the
     *     account itself is the problem (none, disabled, deleted, no membership)
     */
    public record Denial(String reason, String missing) {}

    /** Whether {@code userId} holds {@code permission} in the project now. */
    public boolean permitted(long projectId, long userId, PublishPermission permission) {
        return denial(projectId, userId, PublishRequirements.permission(permission)).isEmpty();
    }

    /** Whether {@code userId} holds {@code minimumRole} (or higher) in the project now. */
    public boolean hasRole(long projectId, long userId, ProjectRole minimumRole) {
        return denial(projectId, userId, PublishRequirements.role(minimumRole)).isEmpty();
    }

    /** Why {@code userId} doesn't satisfy {@code requirements} under the project's current policy; empty when they do. */
    public Optional<Denial> denial(long projectId, Long userId, PublishRequirements requirements) {
        return denial(projectId, userId, requirements, null);
    }

    /**
     * As {@link #denial(long, Long, PublishRequirements)} under {@code policy} instead of the stored one — what a
     * proposed policy would do ({@code POST …/publish-policy/impact}). {@code null} reads the stored policy.
     */
    public Optional<Denial> denial(long projectId, Long userId, PublishRequirements requirements, PublishPolicy policy) {
        if (userId == null) {
            return Optional.of(new Denial("the action has no owner", null));
        }
        AppUser user = users.findById(userId).orElse(null);
        if (user == null) {
            return Optional.of(new Denial("the account no longer exists", null));
        }
        if (user.getStatus() == UserStatus.DISABLED) {
            return Optional.of(new Denial("the account '" + user.getUsername() + "' is disabled", null));
        }
        if (user.getStatus() == UserStatus.DELETED) {
            return Optional.of(new Denial("the account was deleted", null));
        }
        if (user.getSystemRole() == SystemRole.INSTANCE_ADMIN) {
            return Optional.empty();
        }
        Optional<ProjectRole> role = members.findByProjectIdAndUserId(projectId, userId).map(ProjectMember::getRole);
        if (role.isEmpty()) {
            return Optional.of(new Denial("'" + user.getUsername() + "' is no longer a member of the project", null));
        }
        PublishPolicy effective = policy != null ? policy : policy(projectId);
        return requirements.missing(role.get(), effective).map(missing -> new Denial(
                missing.startsWith(PublishRequirements.ROLE_PREFIX)
                        ? "'" + user.getUsername() + "' is " + role.get() + ", this needs " + requirements.minimumRole()
                        : "'" + user.getUsername() + "' is " + role.get() + " without " + missing
                                + " in the project's publish policy",
                missing));
    }

    /** The project's stored policy ({@link PublishPolicy#EMPTY} for an unknown project). */
    public PublishPolicy policy(long projectId) {
        return projects.findPublishPolicyById(projectId).map(PublishPolicy::fromJson).orElse(PublishPolicy.EMPTY);
    }
}
