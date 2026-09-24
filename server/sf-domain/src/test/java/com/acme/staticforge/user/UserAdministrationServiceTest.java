package com.acme.staticforge.user;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.when;

import com.acme.staticforge.audit.AuditService;
import com.acme.staticforge.common.SfException;
import com.acme.staticforge.project.ProjectMemberRepository;
import com.acme.staticforge.project.ProjectRepository;
import com.acme.staticforge.project.ProjectService;
import com.acme.staticforge.security.RefreshTokenRepository;
import java.time.Instant;
import java.util.List;

import org.assertj.core.api.ThrowableAssert.ThrowingCallable;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.test.util.ReflectionTestUtils;

/**
 * Guard rails of {@link UserAdministrationService} (M26 decision 8) that the shared integration database can't
 * isolate: the last {@code ACTIVE} instance admin can't be disabled, deleted or demoted.
 */
@ExtendWith(MockitoExtension.class)
class UserAdministrationServiceTest {

    private static final long ACTOR = 1L;
    private static final long TARGET = 2L;

    @Mock AppUserRepository users;
    @Mock UserService userService;
    @Mock PasswordService passwords;
    @Mock PasswordPolicy passwordPolicy;
    @Mock ProjectService projectService;
    @Mock ProjectRepository projects;
    @Mock ProjectMemberRepository members;
    @Mock RefreshTokenRepository refreshTokens;
    @Mock AuditService auditService;

    UserAdministrationService service;
    AppUser target;

    @BeforeEach
    void setUp() {
        service = new UserAdministrationService(
                users, userService, passwords, passwordPolicy, projectService, projects, members, refreshTokens,
                auditService);
        target = new AppUser("target", "target@example.com", Instant.now());
        ReflectionTestUtils.setField(target, "id", TARGET);
        target.setSystemRole(SystemRole.INSTANCE_ADMIN);
        when(userService.requireById(TARGET)).thenReturn(target);
        lenient().when(users.save(target)).thenReturn(target);
        lenient().when(members.findByUserId(TARGET)).thenReturn(List.of());
    }

    private void activeAdmins(long count) {
        when(users.countBySystemRoleAndStatus(SystemRole.INSTANCE_ADMIN, UserStatus.ACTIVE)).thenReturn(count);
    }

    private static void assertCode(ThrowingCallable call, String code) {
        assertThatThrownBy(call)
                .isInstanceOfSatisfying(SfException.class, e -> assertThat(e.getProblem().getExtensions())
                        .containsEntry("code", code));
    }

    @Test
    void theLastActiveAdminCantBeDisabledDeletedOrDemoted() {
        activeAdmins(1);

        assertCode(() -> service.disable(TARGET, ACTOR), "SF-DOM-0131");
        assertCode(() -> service.delete(TARGET, "target", ACTOR), "SF-DOM-0131");
        assertCode(() -> service.setSystemRole(TARGET, SystemRole.USER, ACTOR), "SF-DOM-0131");
        assertThat(target.getStatus()).isEqualTo(UserStatus.ACTIVE);
        assertThat(target.getSystemRole()).isEqualTo(SystemRole.INSTANCE_ADMIN);
    }

    @Test
    void anAdminWithAnActivePeerCanBeDisabledDeletedAndDemoted() {
        activeAdmins(2);

        service.setSystemRole(TARGET, SystemRole.USER, ACTOR);
        assertThat(target.getSystemRole()).isEqualTo(SystemRole.USER);

        target.setSystemRole(SystemRole.INSTANCE_ADMIN);
        service.disable(TARGET, ACTOR);
        assertThat(target.getStatus()).isEqualTo(UserStatus.DISABLED);
    }

    @Test
    void anAdminWhoIsNotActiveDoesNotCountAsTheLastOne() {
        // A locked admin can be disabled although only one (other) admin is active.
        target.setStatus(UserStatus.LOCKED);

        service.disable(TARGET, ACTOR);

        assertThat(target.getStatus()).isEqualTo(UserStatus.DISABLED);
    }

    @Test
    void selfActionsAreRefusedEvenWithManyAdmins() {
        lenient().when(users.countBySystemRoleAndStatus(SystemRole.INSTANCE_ADMIN, UserStatus.ACTIVE))
                .thenReturn(10L);

        assertCode(() -> service.disable(TARGET, TARGET), "SF-DOM-0132");
        assertCode(() -> service.delete(TARGET, "target", TARGET), "SF-DOM-0132");
        assertCode(() -> service.setSystemRole(TARGET, SystemRole.USER, TARGET), "SF-DOM-0132");
    }

    @Test
    void promotingIsNeverGuardedAndRevokesAccess() {
        target.setSystemRole(SystemRole.USER);

        service.setSystemRole(TARGET, SystemRole.INSTANCE_ADMIN, ACTOR);

        assertThat(target.getSystemRole()).isEqualTo(SystemRole.INSTANCE_ADMIN);
        assertThat(target.getTokenEpoch()).isEqualTo(1L);
    }
}
