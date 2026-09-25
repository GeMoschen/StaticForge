package com.acme.staticforge.release;

import com.acme.staticforge.common.ProblemFactory;
import com.acme.staticforge.common.SfException;
import com.acme.staticforge.project.ProjectMember;
import com.acme.staticforge.project.ProjectMemberRepository;
import com.acme.staticforge.project.ProjectRole;
import com.acme.staticforge.revision.RevisionContext;
import com.acme.staticforge.user.AppUser;
import com.acme.staticforge.user.SystemRole;
import com.acme.staticforge.user.UserService;
import com.acme.staticforge.user.UserStatus;
import org.springframework.stereotype.Component;

/**
 * The M27 rule for release state (epic decision 15): {@code DEVELOPER} or above in the project, or an instance admin.
 * Read from the database rather than a token, because a scheduled action (M27.4) runs without one.
 */
@Component
public class RoleReleasePermissionCheck implements ReleasePermissionCheck {

    private final ProjectMemberRepository members;
    private final UserService users;

    public RoleReleasePermissionCheck(ProjectMemberRepository members, UserService users) {
        this.members = members;
        this.users = users;
    }

    @Override
    public void requireRelease(RevisionContext ctx) {
        requireDeveloper(ctx, "release");
    }

    @Override
    public void requireUnpublish(RevisionContext ctx) {
        requireDeveloper(ctx, "unpublish");
    }

    @Override
    public void requireDiscard(RevisionContext ctx) {
        requireDeveloper(ctx, "discard changes");
    }

    private void requireDeveloper(RevisionContext ctx, String operation) {
        if (ctx.userId() == null) {
            return;
        }
        AppUser user = users.findById(ctx.userId()).orElse(null);
        if (user != null && user.getStatus() == UserStatus.ACTIVE && user.getSystemRole() == SystemRole.INSTANCE_ADMIN) {
            return;
        }
        boolean allowed = user != null
                && user.getStatus() != UserStatus.DISABLED
                && user.getStatus() != UserStatus.DELETED
                && members.findByProjectIdAndUserId(ctx.projectId(), ctx.userId())
                        .map(ProjectMember::getRole)
                        .map(role -> role.atLeast(ProjectRole.DEVELOPER))
                        .orElse(false);
        if (!allowed) {
            throw new SfException(ProblemFactory.forbidden("Only developers and project admins may " + operation + "."));
        }
    }
}
