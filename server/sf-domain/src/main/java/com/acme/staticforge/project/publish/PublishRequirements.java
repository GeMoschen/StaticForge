package com.acme.staticforge.project.publish;

import com.acme.staticforge.project.ProjectRole;
import java.util.Collections;
import java.util.EnumSet;
import java.util.Optional;
import java.util.Set;

/**
 * What a user needs for a publishing operation (M28, epic decisions 5–9): a minimum project role plus publish
 * permissions. One type for every path — a release endpoint, a generation request (the body decides, {@code
 * GenerationAuthorization}), a scheduled action ({@code ScheduledActionHandler#requirements}) — evaluated for the
 * caller's token by {@code ProjectAuthorizationService} and for a stored user by {@link PublishPermissionEvaluator}.
 */
public record PublishRequirements(ProjectRole minimumRole, Set<PublishPermission> permissions) {

    /** The prefix of a role-only {@link #missing} code, e.g. {@code "ROLE:DEVELOPER"} (epic decision 6). */
    public static final String ROLE_PREFIX = "ROLE:";

    public PublishRequirements {
        minimumRole = minimumRole == null ? ProjectRole.VIEWER : minimumRole;
        EnumSet<PublishPermission> copy = EnumSet.noneOf(PublishPermission.class);
        if (permissions != null) {
            copy.addAll(permissions);
        }
        permissions = Collections.unmodifiableSet(copy);
    }

    /** A role-only requirement. */
    public static PublishRequirements role(ProjectRole minimumRole) {
        return new PublishRequirements(minimumRole, Set.of());
    }

    /** Publish permissions, no role beyond membership: a viewer is refused by {@link PublishPolicy#grants}. */
    public static PublishRequirements permission(PublishPermission... permissions) {
        return new PublishRequirements(ProjectRole.VIEWER, Set.of(permissions));
    }

    /**
     * Parses {@code "RELEASE"} or {@code "ROLE:DEVELOPER"} — the literals of {@code @projectAuth.can(...)} in
     * {@code @PreAuthorize}. Throws {@link IllegalArgumentException} for anything else.
     */
    public static PublishRequirements parse(String code) {
        if (code != null && code.startsWith(ROLE_PREFIX)) {
            return role(ProjectRole.valueOf(code.substring(ROLE_PREFIX.length())));
        }
        return permission(PublishPermission.byName(code)
                .orElseThrow(() -> new IllegalArgumentException("Unknown publish permission '" + code + "'.")));
    }

    /** Both: the higher role and every permission of either. */
    public PublishRequirements and(PublishRequirements other) {
        EnumSet<PublishPermission> union = EnumSet.noneOf(PublishPermission.class);
        union.addAll(permissions);
        union.addAll(other.permissions);
        return new PublishRequirements(
                minimumRole.atLeast(other.minimumRole) ? minimumRole : other.minimumRole, union);
    }

    /**
     * The first thing {@code role} lacks under {@code policy} — {@code "ROLE:<minimum>"} or a permission name — or
     * empty when it has everything. The role is checked first, then the permissions in declaration order.
     */
    public Optional<String> missing(ProjectRole role, PublishPolicy policy) {
        if (!role.atLeast(minimumRole)) {
            return Optional.of(ROLE_PREFIX + minimumRole.name());
        }
        return permissions.stream().filter(p -> !policy.grants(role, p)).findFirst().map(Enum::name);
    }
}
