package com.acme.staticforge.user;

import com.acme.staticforge.audit.AuditService;
import com.acme.staticforge.common.ProblemFactory;
import com.acme.staticforge.common.SfException;
import com.acme.staticforge.preferences.UserPreferencesRepository;
import com.acme.staticforge.project.Project;
import com.acme.staticforge.project.ProjectMember;
import com.acme.staticforge.project.ProjectMemberRepository;
import com.acme.staticforge.project.ProjectRepository;
import com.acme.staticforge.project.ProjectRole;
import com.acme.staticforge.project.ProjectService;
import com.acme.staticforge.revision.RevisionContext;
import com.acme.staticforge.security.RefreshTokenRepository;
import com.fasterxml.jackson.databind.node.ObjectNode;
import jakarta.persistence.criteria.Predicate;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Collection;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.data.domain.Sort;
import org.springframework.data.jpa.domain.Specification;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Instance administration of user accounts (M26, spec §8.2): list, create, edit, disable/enable, unlock, reset the
 * password, grant or revoke instance admin, revoke sessions and delete (anonymize). Only {@code INSTANCE_ADMIN}
 * reaches it — the controller guards that; this service enforces the guard rails every caller must respect:
 *
 * <ul>
 *   <li>the last {@code ACTIVE} instance admin can't be disabled, deleted or demoted ({@code 409 SF-DOM-0131});
 *   <li>an admin can't disable, delete or demote themselves ({@code 409 SF-DOM-0132});
 *   <li>nothing applies to a {@code DELETED} account ({@code 409}).
 * </ul>
 *
 * <p>Every action that narrows what an account may do — disable, delete, password reset, system role change and
 * revoke sessions — bumps the token epoch and drops all refresh tokens, so it applies on the account's next request
 * (spec §9.2). Every action writes an instance-level audit entry ({@code project_id} null) with the acting admin as
 * actor, {@code user:<username>} as target and {@code {"userId": …}} in the detail.
 */
@Service
public class UserAdministrationService {

    /** Columns a user listing may be sorted by; anything else is {@code 400}. */
    public static final Set<String> SORTABLE =
            Set.of("username", "displayName", "email", "status", "systemRole", "lastLoginAt", "createdAt");

    static final String DELETED_DISPLAY_NAME = "Deleted user";

    private final AppUserRepository users;
    private final UserService userService;
    private final PasswordService passwords;
    private final PasswordPolicy passwordPolicy;
    private final ProjectService projectService;
    private final ProjectRepository projects;
    private final ProjectMemberRepository members;
    private final RefreshTokenRepository refreshTokens;
    private final UserPreferencesRepository preferences;
    private final AuditService auditService;

    public UserAdministrationService(
            AppUserRepository users,
            UserService userService,
            PasswordService passwords,
            PasswordPolicy passwordPolicy,
            ProjectService projectService,
            ProjectRepository projects,
            ProjectMemberRepository members,
            RefreshTokenRepository refreshTokens,
            UserPreferencesRepository preferences,
            AuditService auditService) {
        this.users = users;
        this.userService = userService;
        this.passwords = passwords;
        this.passwordPolicy = passwordPolicy;
        this.projectService = projectService;
        this.projects = projects;
        this.members = members;
        this.refreshTokens = refreshTokens;
        this.preferences = preferences;
        this.auditService = auditService;
    }

    /** Listing filter; {@code q} matches username, email and display name ignoring case. */
    public record UserFilter(String q, UserStatus status, SystemRole systemRole, boolean includeDeleted) {}

    /** One initial membership of a new account. */
    public record MembershipGrant(String projectKey, ProjectRole role) {}

    /**
     * A new account. Exactly one of {@code password} (must meet the policy) or {@code generatePassword} is given.
     */
    public record NewUser(
            String username,
            String email,
            String displayName,
            SystemRole systemRole,
            String password,
            boolean generatePassword,
            boolean mustChangePassword,
            List<MembershipGrant> memberships) {}

    /** An account together with the password the server generated for it (shown once), or {@code null}. */
    public record WithPassword(AppUser user, String generatedPassword) {}

    /** One membership of an account, resolved for display. */
    public record Membership(
            String projectKey,
            String projectName,
            boolean archived,
            ProjectRole role,
            Instant grantedAt,
            String grantedByUsername) {}

    @Transactional(readOnly = true)
    public Page<AppUser> search(UserFilter filter, Pageable pageable) {
        Pageable effective = pageable.getSort().isSorted()
                ? pageable
                : PageRequest.of(pageable.getPageNumber(), pageable.getPageSize(), Sort.by("username"));
        for (Sort.Order order : effective.getSort()) {
            if (!SORTABLE.contains(order.getProperty())) {
                throw new SfException(ProblemFactory.badRequest(
                        "Can't sort users by '" + order.getProperty() + "'; use one of " + SORTABLE + ".", "sort"));
            }
        }
        return users.findAll(specification(filter), effective);
    }

    /** Number of project memberships per user id; users without any are absent. */
    @Transactional(readOnly = true)
    public Map<Long, Long> projectCounts(Collection<Long> userIds) {
        Map<Long, Long> counts = new HashMap<>();
        if (userIds.isEmpty()) {
            return counts;
        }
        for (Object[] row : members.countByUserIds(userIds)) {
            counts.put((Long) row[0], (Long) row[1]);
        }
        return counts;
    }

    @Transactional(readOnly = true)
    public List<Membership> memberships(Long userId) {
        List<ProjectMember> list = members.findByUserId(userId);
        Map<Long, Project> byId = new HashMap<>();
        projects.findAllById(list.stream().map(ProjectMember::getProjectId).toList())
                .forEach(p -> byId.put(p.getId(), p));
        Map<Long, String> grantors = new HashMap<>();
        users.findAllById(list.stream().map(ProjectMember::getGrantedBy).filter(id -> id != null).toList())
                .forEach(u -> grantors.put(u.getId(), u.getUsername()));
        return list.stream()
                .filter(m -> byId.containsKey(m.getProjectId()))
                .map(m -> {
                    Project project = byId.get(m.getProjectId());
                    return new Membership(
                            project.getKey(),
                            project.getName(),
                            project.isArchived(),
                            m.getRole(),
                            m.getGrantedAt(),
                            m.getGrantedBy() == null ? null : grantors.get(m.getGrantedBy()));
                })
                .sorted((a, b) -> a.projectKey().compareTo(b.projectKey()))
                .toList();
    }

    @Transactional
    public WithPassword create(NewUser request, Long actorId) {
        String username = userService.requireUsableUsername(request.username(), null);
        String email = userService.requireUsableEmail(request.email(), null);
        String displayName = UserService.normalizeDisplayName(request.displayName());
        String generated = null;
        String password;
        if (request.generatePassword()) {
            requireNoTypedPassword(request.password());
            password = generated = passwordPolicy.generate();
        } else {
            password = requireTypedPassword(request.password());
        }

        AppUser user = new AppUser(username, email, Instant.now());
        user.setDisplayName(displayName);
        user.setPasswordHash(passwords.hash(password));
        user.setSystemRole(request.systemRole() == null ? SystemRole.USER : request.systemRole());
        user.setMustChangePassword(request.mustChangePassword());
        user = users.save(user);

        ObjectNode detail = UserService.userDetail(user.getId())
                .put("systemRole", user.getSystemRole().name())
                .put("mustChangePassword", user.isMustChangePassword())
                .put("generatedPassword", generated != null);
        auditService.record(null, actorId, "USER_CREATED", target(user), detail);

        List<MembershipGrant> grants = request.memberships() == null ? List.of() : request.memberships();
        for (MembershipGrant grant : grants) {
            if (grant == null || grant.projectKey() == null || grant.role() == null) {
                throw new SfException(
                        ProblemFactory.badRequest("Each membership needs a projectKey and a role.", "memberships"));
            }
            Project project = projectService.requireByKey(grant.projectKey());
            projectService.setMemberRole(
                    project.getKey(), user.getId(), grant.role(), RevisionContext.of(project.getId(), actorId, null));
        }
        return new WithPassword(users.findById(user.getId()).orElseThrow(), generated);
    }

    /** Admin profile edit: username, email and display name with PATCH semantics (see {@link UserService}). */
    @Transactional
    public AppUser update(Long userId, UserService.ProfileUpdate update, Long actorId) {
        requireNotDeleted(userId);
        userService.updateProfile(userId, update, actorId);
        return userService.requireById(userId);
    }

    @Transactional
    public AppUser disable(Long userId, Long actorId) {
        AppUser user = requireNotDeleted(userId);
        requireNotSelf(userId, actorId, "disable");
        requireNotLastActiveAdmin(user, "disable");
        if (user.getStatus() != UserStatus.DISABLED) {
            user.setStatus(UserStatus.DISABLED);
            users.save(user);
            revokeSessions(user);
            auditService.record(null, actorId, "USER_DISABLED", target(user), UserService.userDetail(userId));
        }
        return user;
    }

    /** Re-enables a disabled account; its memberships were kept, so its access returns as it was. */
    @Transactional
    public AppUser enable(Long userId, Long actorId) {
        AppUser user = requireNotDeleted(userId);
        if (user.getStatus() == UserStatus.DISABLED) {
            user.setStatus(UserStatus.ACTIVE);
            users.save(user);
            auditService.record(null, actorId, "USER_ENABLED", target(user), UserService.userDetail(userId));
        }
        return user;
    }

    /** Lifts a lockout: clears the failed-login counter and the lock; a {@code LOCKED} account becomes active. */
    @Transactional
    public AppUser unlock(Long userId, Long actorId) {
        AppUser user = requireNotDeleted(userId);
        user.setFailedLogins(0);
        user.setLockedUntil(null);
        if (user.getStatus() == UserStatus.LOCKED) {
            user.setStatus(UserStatus.ACTIVE);
        }
        users.save(user);
        auditService.record(null, actorId, "USER_UNLOCKED", target(user), UserService.userDetail(userId));
        return user;
    }

    /** Signs the account out everywhere: every access token stops working, every refresh token is dropped. */
    @Transactional
    public void revokeSessions(Long userId, Long actorId) {
        AppUser user = requireNotDeleted(userId);
        revokeSessions(user);
        auditService.record(null, actorId, "USER_SESSIONS_REVOKED", target(user), UserService.userDetail(userId));
    }

    /**
     * Sets a password on the admin's behalf — typed (must meet the policy) or generated — and signs the account
     * out everywhere. With {@code mustChangePassword} the account must choose its own password next.
     */
    @Transactional
    public WithPassword resetPassword(
            Long userId, String password, boolean generatePassword, boolean mustChangePassword, Long actorId) {
        AppUser user = requireNotDeleted(userId);
        String generated = null;
        String effective;
        if (generatePassword) {
            requireNoTypedPassword(password);
            effective = generated = passwordPolicy.generate();
        } else {
            effective = requireTypedPassword(password);
        }
        user.setPasswordHash(passwords.hash(effective));
        user.setMustChangePassword(mustChangePassword);
        users.save(user);
        revokeSessions(user);
        ObjectNode detail = UserService.userDetail(userId)
                .put("mustChangePassword", mustChangePassword)
                .put("generatedPassword", generated != null);
        auditService.record(null, actorId, "USER_PASSWORD_RESET", target(user), detail);
        return new WithPassword(user, generated);
    }

    @Transactional
    public AppUser setSystemRole(Long userId, SystemRole systemRole, Long actorId) {
        if (systemRole == null) {
            throw new SfException(ProblemFactory.badRequest("systemRole is required.", "systemRole"));
        }
        AppUser user = requireNotDeleted(userId);
        if (user.getSystemRole() == systemRole) {
            return user;
        }
        if (systemRole != SystemRole.INSTANCE_ADMIN) {
            requireNotSelf(userId, actorId, "revoke instance admin from");
            requireNotLastActiveAdmin(user, "revoke instance admin from");
        }
        SystemRole previous = user.getSystemRole();
        user.setSystemRole(systemRole);
        users.save(user);
        revokeSessions(user);
        ObjectNode detail = UserService.userDetail(userId)
                .put("systemRole", systemRole.name())
                .put("previousSystemRole", previous.name());
        auditService.record(null, actorId, "USER_SYSTEM_ROLE_SET", target(user), detail);
        return user;
    }

    /**
     * Deletes the account by anonymizing it (M26 decision 5): irreversible. The row stays — revisions, audit entries
     * and grants reference it — but every personal field goes: username {@code deleted-user-<id>}, email
     * {@code deleted-<id>@invalid}, display name {@code Deleted user}, no password, no lockout state, no instance
     * role. Every membership is removed (one revision per project), every session revoked, and the account's audit
     * entries lose its name. {@code confirm} must equal the current username ({@code 400} otherwise).
     */
    @Transactional
    public AppUser delete(Long userId, String confirm, Long actorId) {
        AppUser user = requireNotDeleted(userId);
        if (confirm == null || !confirm.equals(user.getUsername())) {
            throw new SfException(ProblemFactory.badRequest(
                    "Type the account's current username to confirm the deletion.", "confirm"));
        }
        requireNotSelf(userId, actorId, "delete");
        requireNotLastActiveAdmin(user, "delete");

        for (ProjectMember member : members.findByUserId(userId)) {
            Project project = projects.findById(member.getProjectId()).orElse(null);
            if (project != null) {
                // Also from an archived project: the account goes, whatever state its projects are in.
                projectService.removeMemberOfDeletedAccount(
                        project.getKey(), userId, RevisionContext.of(project.getId(), actorId, null));
            }
        }

        String username = UserService.DELETED_USERNAME_PREFIX + userId;
        user.setUsername(username);
        user.setEmail("deleted-" + userId + UserService.DELETED_EMAIL_DOMAIN);
        user.setDisplayName(DELETED_DISPLAY_NAME);
        user.setPasswordHash(null);
        user.setFailedLogins(0);
        user.setLockedUntil(null);
        user.setMustChangePassword(false);
        user.setSystemRole(SystemRole.USER);
        user.setStatus(UserStatus.DELETED);
        users.save(user);
        revokeSessions(user);
        // The row stays (anonymized), so the preferences document does not cascade away with it.
        preferences.deleteByUserId(userId);

        auditService.anonymizeUser(userId, target(user));
        auditService.record(null, actorId, "USER_DELETED", target(user), UserService.userDetail(userId));
        return user;
    }

    private void revokeSessions(AppUser user) {
        user.setTokenEpoch(user.getTokenEpoch() + 1);
        users.save(user);
        refreshTokens.deleteByUserId(user.getId());
    }

    private AppUser requireNotDeleted(Long userId) {
        AppUser user = userService.requireById(userId);
        if (user.getStatus() == UserStatus.DELETED) {
            throw new SfException(ProblemFactory.conflict("This account was deleted; nothing applies to it any more."));
        }
        return user;
    }

    private static void requireNotSelf(Long userId, Long actorId, String verb) {
        if (userId.equals(actorId)) {
            throw new SfException(ProblemFactory.other(
                    409, "SF-DOM-0132", "Conflict", "You can't " + verb + " your own account."));
        }
    }

    private void requireNotLastActiveAdmin(AppUser user, String verb) {
        if (user.getSystemRole() == SystemRole.INSTANCE_ADMIN
                && user.getStatus() == UserStatus.ACTIVE
                && users.countBySystemRoleAndStatus(SystemRole.INSTANCE_ADMIN, UserStatus.ACTIVE) <= 1) {
            throw new SfException(ProblemFactory.other(
                    409,
                    "SF-DOM-0131",
                    "Conflict",
                    "Can't " + verb + " the last active instance admin; make another account instance admin first."));
        }
    }

    private String requireTypedPassword(String password) {
        if (password == null || password.isEmpty()) {
            throw new SfException(ProblemFactory.badRequest(
                    "Give a password or set generatePassword to let the server generate one.", "password"));
        }
        passwordPolicy.requireValid(password);
        return password;
    }

    private void requireNoTypedPassword(String password) {
        if (password != null && !password.isEmpty()) {
            throw new SfException(ProblemFactory.badRequest(
                    "Give either a password or generatePassword, not both.", "password"));
        }
    }

    private static String target(AppUser user) {
        return "user:" + user.getUsername();
    }

    private static Specification<AppUser> specification(UserFilter filter) {
        return (root, query, cb) -> {
            List<Predicate> predicates = new ArrayList<>();
            if (filter.status() != null) {
                predicates.add(cb.equal(root.get("status"), filter.status()));
            } else if (!filter.includeDeleted()) {
                predicates.add(cb.notEqual(root.get("status"), UserStatus.DELETED));
            }
            if (filter.systemRole() != null) {
                predicates.add(cb.equal(root.get("systemRole"), filter.systemRole()));
            }
            if (filter.q() != null && !filter.q().isBlank()) {
                String pattern = "%" + escapeLike(filter.q().trim().toLowerCase(Locale.ROOT)) + "%";
                predicates.add(cb.or(
                        cb.like(cb.lower(root.get("username")), pattern, '\\'),
                        cb.like(cb.lower(root.get("email")), pattern, '\\'),
                        cb.like(cb.lower(cb.coalesce(root.get("displayName"), "")), pattern, '\\')));
            }
            return cb.and(predicates.toArray(Predicate[]::new));
        };
    }

    private static String escapeLike(String value) {
        return value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_");
    }
}
