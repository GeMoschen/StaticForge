package com.acme.staticforge.bootstrap;

import static org.mockito.ArgumentMatchers.anyBoolean;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.acme.staticforge.user.UserService;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.mock.env.MockEnvironment;

/** The seeded instance admin only lands in an empty user table (M26.1.1, epic decision 11). */
@ExtendWith(MockitoExtension.class)
class DevAdminInitializerTest {

    @Mock UserService userService;

    private DevAdminInitializer initializer(String... profiles) {
        MockEnvironment environment = new MockEnvironment();
        environment.setActiveProfiles(profiles);
        return new DevAdminInitializer(userService, environment);
    }

    @ParameterizedTest
    @ValueSource(strings = {"dev", "demo", "test"})
    void seedsKnownPasswordWithoutForcedChangeInLocalProfiles(String profile) {
        when(userService.isEmpty()).thenReturn(true);

        initializer(profile).run();

        verify(userService).createInstanceAdmin("Admin", "admin@staticforge.local", "Administrator", "Admin", false);
    }

    @Test
    void forcesPasswordChangeInProdLikeProfiles() {
        when(userService.isEmpty()).thenReturn(true);

        initializer("prod").run();

        verify(userService).createInstanceAdmin("Admin", "admin@staticforge.local", "Administrator", "Admin", true);
    }

    @Test
    void forcesPasswordChangeWithoutAnyProfile() {
        when(userService.isEmpty()).thenReturn(true);

        initializer().run();

        verify(userService).createInstanceAdmin("Admin", "admin@staticforge.local", "Administrator", "Admin", true);
    }

    @Test
    void seedsNothingOnceAnyUserExists() {
        // E.g. "Admin" was renamed or deleted: no user is called Admin any more, but the table is not empty.
        when(userService.isEmpty()).thenReturn(false);

        initializer("dev").run();

        verify(userService, never())
                .createInstanceAdmin(anyString(), anyString(), anyString(), anyString(), anyBoolean());
    }
}
