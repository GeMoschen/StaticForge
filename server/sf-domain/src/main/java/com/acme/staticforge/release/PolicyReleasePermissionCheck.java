package com.acme.staticforge.release;

import com.acme.staticforge.common.ProblemFactory;
import com.acme.staticforge.common.SfException;
import com.acme.staticforge.project.publish.PublishPermission;
import com.acme.staticforge.project.publish.PublishPermissionEvaluator;
import com.acme.staticforge.project.publish.PublishRequirements;
import com.acme.staticforge.revision.RevisionContext;
import org.springframework.stereotype.Component;

/**
 * The M28 rule for release state (epic decision 8): {@link PublishPermission#RELEASE} under the project's publish
 * policy — always held by developers, project admins and instance admins, by editors when the policy opens it. Read
 * from the database ({@link PublishPermissionEvaluator}) rather than a token, because a scheduled action runs without
 * one: the owner of a scheduled release must still hold {@code RELEASE} when it executes.
 */
@Component
public class PolicyReleasePermissionCheck implements ReleasePermissionCheck {

    private static final PublishRequirements RELEASE = PublishRequirements.permission(PublishPermission.RELEASE);

    private final PublishPermissionEvaluator evaluator;

    public PolicyReleasePermissionCheck(PublishPermissionEvaluator evaluator) {
        this.evaluator = evaluator;
    }

    @Override
    public void requireRelease(RevisionContext ctx) {
        require(ctx, "release");
    }

    @Override
    public void requireUnpublish(RevisionContext ctx) {
        require(ctx, "unpublish");
    }

    @Override
    public void requireDiscard(RevisionContext ctx) {
        require(ctx, "discard changes");
    }

    private void require(RevisionContext ctx, String operation) {
        if (ctx.userId() == null) {
            return;
        }
        evaluator.denial(ctx.projectId(), ctx.userId(), RELEASE).ifPresent(denial -> {
            String detail = "Not permitted to " + operation + ": " + denial.reason() + ".";
            throw new SfException(denial.missing() == null
                    ? ProblemFactory.forbidden(detail)
                    : ProblemFactory.forbidden(detail, denial.missing()));
        });
    }
}
