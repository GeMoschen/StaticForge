package com.acme.staticforge.api;

import com.acme.staticforge.api.dto.AdminMembership;
import com.acme.staticforge.api.dto.AdminUserDetail;
import com.acme.staticforge.api.dto.AdminUserPage;
import com.acme.staticforge.api.dto.AdminUserRow;
import com.acme.staticforge.api.dto.CreateUserRequest;
import com.acme.staticforge.api.dto.RecordPageView;
import com.acme.staticforge.api.dto.ResetPasswordRequest;
import com.acme.staticforge.api.dto.SetSystemRoleRequest;
import com.acme.staticforge.api.dto.UpdateUserRequest;
import com.acme.staticforge.common.ProblemFactory;
import com.acme.staticforge.common.SfException;
import com.acme.staticforge.project.ProjectRole;
import com.acme.staticforge.security.SecuritySupport;
import com.acme.staticforge.user.AppUser;
import com.acme.staticforge.user.SystemRole;
import com.acme.staticforge.user.UserAdministrationService;
import com.acme.staticforge.user.UserAdministrationService.MembershipGrant;
import com.acme.staticforge.user.UserAdministrationService.WithPassword;
import com.acme.staticforge.user.UserService;
import com.acme.staticforge.user.UserStatus;
import java.net.URI;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import org.springdoc.core.annotations.ParameterObject;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.web.PageableDefault;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * Instance administration of user accounts (M26.1.2): {@code /api/v1/admin/users/**}, instance admins only. The
 * rules — guard rails, session revocation, anonymizing delete, audit — live in {@link UserAdministrationService};
 * this controller parses requests and shapes responses.
 */
@RestController
@RequestMapping("/api/v1/admin/users")
@PreAuthorize("hasAuthority('SYS_INSTANCE_ADMIN')")
public class AdminUserController {

    private static final int MAX_PAGE_SIZE = 200;

    private final UserAdministrationService administration;
    private final UserService userService;
    private final SecuritySupport securitySupport;

    public AdminUserController(
            UserAdministrationService administration, UserService userService, SecuritySupport securitySupport) {
        this.administration = administration;
        this.userService = userService;
        this.securitySupport = securitySupport;
    }

    /**
     * Users, paged on the server. {@code q} matches username, email and display name ignoring case; deleted
     * accounts are left out unless {@code includeDeleted} or {@code status=DELETED}. {@code sort} is
     * {@code property[,asc|desc]} (repeatable), default {@code username}; {@code size} is at most {@value
     * #MAX_PAGE_SIZE}.
     */
    @GetMapping
    public AdminUserPage list(
            @RequestParam(required = false) String q,
            @RequestParam(required = false) String status,
            @RequestParam(required = false) String systemRole,
            @RequestParam(defaultValue = "false") boolean includeDeleted,
            @ParameterObject @PageableDefault(size = 50, sort = "username") Pageable pageable) {
        if (pageable.getPageSize() > MAX_PAGE_SIZE) {
            throw new SfException(
                    ProblemFactory.badRequest("size must be at most " + MAX_PAGE_SIZE + ".", "size"));
        }
        UserAdministrationService.UserFilter filter = new UserAdministrationService.UserFilter(
                q,
                parseEnum(UserStatus.class, status, "status"),
                parseEnum(SystemRole.class, systemRole, "systemRole"),
                includeDeleted);
        Page<AppUser> result = administration.search(filter, pageable);
        Map<Long, Long> counts =
                administration.projectCounts(result.getContent().stream().map(AppUser::getId).toList());
        List<AdminUserRow> rows = result.getContent().stream()
                .map(u -> toRow(u, counts.getOrDefault(u.getId(), 0L)))
                .toList();
        return new AdminUserPage(
                rows,
                new RecordPageView.PageMeta(
                        result.getSize(), result.getNumber(), result.getTotalElements(), result.getTotalPages()));
    }

    @GetMapping("/{id}")
    public AdminUserDetail detail(@PathVariable Long id) {
        return toDetail(userService.requireById(id), null);
    }

    @PostMapping
    public ResponseEntity<AdminUserDetail> create(@RequestBody CreateUserRequest body) {
        List<MembershipGrant> grants = body.memberships() == null
                ? List.of()
                : body.memberships().stream()
                        .map(m -> m == null
                                ? null
                                : new MembershipGrant(m.projectKey(), parseProjectRole(m.role())))
                        .toList();
        SystemRole systemRole = parseEnum(SystemRole.class, body.systemRole(), "systemRole");
        WithPassword created = administration.create(
                new UserAdministrationService.NewUser(
                        body.username(),
                        body.email(),
                        body.displayName(),
                        systemRole,
                        body.password(),
                        Boolean.TRUE.equals(body.generatePassword()),
                        !Boolean.FALSE.equals(body.mustChangePassword()),
                        grants),
                actor());
        AppUser user = created.user();
        return ResponseEntity.created(URI.create("/api/v1/admin/users/" + user.getId()))
                .body(toDetail(user, created.generatedPassword()));
    }

    @PatchMapping("/{id}")
    public AdminUserDetail update(@PathVariable Long id, @RequestBody UpdateUserRequest body) {
        AppUser user = administration.update(
                id, new UserService.ProfileUpdate(body.username(), body.email(), body.displayName()), actor());
        return toDetail(user, null);
    }

    @PostMapping("/{id}/disable")
    public AdminUserDetail disable(@PathVariable Long id) {
        return toDetail(administration.disable(id, actor()), null);
    }

    @PostMapping("/{id}/enable")
    public AdminUserDetail enable(@PathVariable Long id) {
        return toDetail(administration.enable(id, actor()), null);
    }

    @PostMapping("/{id}/unlock")
    public AdminUserDetail unlock(@PathVariable Long id) {
        return toDetail(administration.unlock(id, actor()), null);
    }

    @PostMapping("/{id}/revoke-sessions")
    public ResponseEntity<Void> revokeSessions(@PathVariable Long id) {
        administration.revokeSessions(id, actor());
        return ResponseEntity.noContent().build();
    }

    @PostMapping("/{id}/password")
    public AdminUserDetail resetPassword(@PathVariable Long id, @RequestBody ResetPasswordRequest body) {
        WithPassword reset = administration.resetPassword(
                id,
                body.password(),
                Boolean.TRUE.equals(body.generatePassword()),
                !Boolean.FALSE.equals(body.mustChangePassword()),
                actor());
        return toDetail(reset.user(), reset.generatedPassword());
    }

    @PutMapping("/{id}/system-role")
    public AdminUserDetail setSystemRole(@PathVariable Long id, @RequestBody SetSystemRoleRequest body) {
        SystemRole role = parseEnum(SystemRole.class, body.systemRole(), "systemRole");
        return toDetail(administration.setSystemRole(id, role, actor()), null);
    }

    /** Deletes (anonymizes) the account; {@code confirm} must be its current username. Irreversible. */
    @DeleteMapping("/{id}")
    public ResponseEntity<Void> delete(@PathVariable Long id, @RequestParam(required = false) String confirm) {
        administration.delete(id, confirm, actor());
        return ResponseEntity.noContent().build();
    }

    private Long actor() {
        return securitySupport.currentUserId();
    }

    private AdminUserDetail toDetail(AppUser user, String generatedPassword) {
        List<AdminMembership> memberships = administration.memberships(user.getId()).stream()
                .map(m -> new AdminMembership(
                        m.projectKey(), m.projectName(), m.archived(), m.role().name(), m.grantedAt(),
                        m.grantedByUsername()))
                .toList();
        return new AdminUserDetail(
                user.getId(),
                user.getUsername(),
                user.getDisplayName(),
                user.getEmail(),
                user.getStatus().name(),
                user.getSystemRole().name(),
                user.isMustChangePassword(),
                user.getLastLoginAt(),
                memberships.size(),
                user.getCreatedAt(),
                user.getFailedLogins(),
                user.getLockedUntil(),
                memberships,
                generatedPassword);
    }

    private static AdminUserRow toRow(AppUser user, long projectCount) {
        return new AdminUserRow(
                user.getId(),
                user.getUsername(),
                user.getDisplayName(),
                user.getEmail(),
                user.getStatus().name(),
                user.getSystemRole().name(),
                user.isMustChangePassword(),
                user.getLastLoginAt(),
                projectCount);
    }

    private static ProjectRole parseProjectRole(String role) {
        try {
            return ProjectRole.fromName(role);
        } catch (IllegalArgumentException | NullPointerException e) {
            throw new SfException(ProblemFactory.badRequest("Unknown project role: " + role, "memberships"));
        }
    }

    private static <E extends Enum<E>> E parseEnum(Class<E> type, String value, String field) {
        if (value == null || value.isBlank()) {
            return null;
        }
        try {
            return Enum.valueOf(type, value.trim().toUpperCase(Locale.ROOT));
        } catch (IllegalArgumentException e) {
            throw new SfException(ProblemFactory.badRequest("Unknown " + field + ": " + value, field));
        }
    }
}
