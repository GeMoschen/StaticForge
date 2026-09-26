package com.acme.staticforge.scheduler;

import com.acme.staticforge.common.ProblemFactory;
import com.acme.staticforge.common.SfException;
import com.acme.staticforge.project.publish.PublishPermissionEvaluator;
import com.acme.staticforge.project.publish.PublishPolicy;
import com.acme.staticforge.project.publish.PublishPermissionEvaluator.Denial;
import com.acme.staticforge.project.publish.PublishRequirements;
import java.util.Optional;
import org.springframework.stereotype.Component;

/**
 * Evaluates a handler's {@link PublishRequirements} for a user (M27.4.1, epic decisions 20 and 25; M28 decision 9) —
 * the caller of a schedules API request and the owner before every execution, so both paths apply the same rule.
 * Delegates to {@link PublishPermissionEvaluator}, which reads the account, the membership and the project's publish
 * policy from the database: an execution has no token, and a token would outlive a demotion or a policy change.
 */
@Component
public class ActionAuthority {

    private final PublishPermissionEvaluator evaluator;

    public ActionAuthority(PublishPermissionEvaluator evaluator) {
        this.evaluator = evaluator;
    }

    /** Why {@code userId} may not own or change an action with {@code requirements}; empty when they may. */
    public Optional<String> denial(long projectId, Long userId, PublishRequirements requirements) {
        return check(projectId, userId, requirements).map(Denial::reason);
    }

    /** As {@link #denial}, with what is missing ({@link Denial#missing()}). */
    public Optional<Denial> check(long projectId, Long userId, PublishRequirements requirements) {
        return evaluator.denial(projectId, userId, requirements);
    }

    /** As {@link #check(long, Long, PublishRequirements)} under a proposed {@code policy} instead of the stored one. */
    public Optional<Denial> check(long projectId, Long userId, PublishRequirements requirements, PublishPolicy policy) {
        return evaluator.denial(projectId, userId, requirements, policy);
    }

    /**
     * Throws {@code 403 SF-API-0403} unless {@code userId} satisfies {@code requirements} in the project; the problem
     * names the missing permission (or {@code "ROLE:<minimum>"}) under {@code permission}.
     */
    public void require(long projectId, Long userId, PublishRequirements requirements) {
        check(projectId, userId, requirements).ifPresent(denial -> {
            String detail = "Not permitted: " + denial.reason() + ".";
            throw new SfException(denial.missing() == null
                    ? ProblemFactory.forbidden(detail)
                    : ProblemFactory.forbidden(detail, denial.missing()));
        });
    }
}
