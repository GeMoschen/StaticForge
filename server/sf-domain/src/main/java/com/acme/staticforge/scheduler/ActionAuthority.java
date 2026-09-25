package com.acme.staticforge.scheduler;

import com.acme.staticforge.common.ProblemFactory;
import com.acme.staticforge.common.SfException;
import com.acme.staticforge.project.ProjectMember;
import com.acme.staticforge.project.ProjectMemberRepository;
import com.acme.staticforge.project.ProjectRole;
import com.acme.staticforge.user.AppUser;
import com.acme.staticforge.user.SystemRole;
import com.acme.staticforge.user.UserService;
import com.acme.staticforge.user.UserStatus;
import java.util.Optional;
import org.springframework.stereotype.Component;

/**
 * Evaluates a handler's {@link ActionRequirements} for a user (M27.4.1, epic decisions 20 and 25) — the caller of a
 * schedules API request and the owner before every execution, so both paths apply the same rule. Reads the account
 * and the membership from the database: an execution has no token, and a token would outlive a demotion.
 *
 * <p>A disabled or deleted account fails; a temporary sign-in lockout ({@code LOCKED}) doesn't. An instance admin
 * passes without membership. Named permissions are M28's publish policy: M27 has none to grant, so an action that
 * names one is refused rather than silently allowed.
 */
@Component
public class ActionAuthority {

    private final UserService users;
    private final ProjectMemberRepository members;

    public ActionAuthority(UserService users, ProjectMemberRepository members) {
        this.users = users;
        this.members = members;
    }

    /** Why {@code userId} may not own or change an action with {@code requirements}; empty when they may. */
    public Optional<String> denial(long projectId, Long userId, ActionRequirements requirements) {
        if (userId == null) {
            return Optional.of("the action has no owner");
        }
        AppUser user = users.findById(userId).orElse(null);
        if (user == null) {
            return Optional.of("the account no longer exists");
        }
        if (user.getStatus() == UserStatus.DISABLED) {
            return Optional.of("the account '" + user.getUsername() + "' is disabled");
        }
        if (user.getStatus() == UserStatus.DELETED) {
            return Optional.of("the account was deleted");
        }
        if (!requirements.permissions().isEmpty()) {
            return Optional.of("needs " + String.join(", ", requirements.permissions()));
        }
        if (user.getSystemRole() == SystemRole.INSTANCE_ADMIN) {
            return Optional.empty();
        }
        Optional<ProjectRole> role = members.findByProjectIdAndUserId(projectId, userId).map(ProjectMember::getRole);
        if (role.isEmpty()) {
            return Optional.of("'" + user.getUsername() + "' is no longer a member of the project");
        }
        if (!role.get().atLeast(requirements.minimumRole())) {
            return Optional.of("'" + user.getUsername() + "' is " + role.get() + ", the action needs "
                    + requirements.minimumRole());
        }
        return Optional.empty();
    }

    /** Throws {@code 403} unless {@code userId} satisfies {@code requirements} in the project. */
    public void require(long projectId, Long userId, ActionRequirements requirements) {
        denial(projectId, userId, requirements).ifPresent(reason -> {
            throw new SfException(ProblemFactory.forbidden("Not permitted: " + reason + "."));
        });
    }
}
