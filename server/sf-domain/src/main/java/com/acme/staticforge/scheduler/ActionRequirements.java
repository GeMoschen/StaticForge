package com.acme.staticforge.scheduler;

import com.acme.staticforge.project.ProjectRole;
import java.util.Set;

/**
 * What a user needs to create, change, take over or own an action (M27.4.1, epic decision 20): a minimum project role
 * plus named permissions. The API checks the caller and the engine re-checks the owner at every execution against the
 * same object ({@link ActionAuthority}), so a handler states its rule once. M27 uses the role only; M28 fills
 * {@code permissions} from the project's publish policy.
 */
public record ActionRequirements(ProjectRole minimumRole, Set<String> permissions) {

    public ActionRequirements {
        permissions = permissions == null ? Set.of() : Set.copyOf(permissions);
    }

    public static ActionRequirements role(ProjectRole minimumRole) {
        return new ActionRequirements(minimumRole, Set.of());
    }
}
