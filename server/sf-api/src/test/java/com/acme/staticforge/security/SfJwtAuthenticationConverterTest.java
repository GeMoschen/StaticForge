package com.acme.staticforge.security;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.when;

import com.acme.staticforge.project.ProjectRole;
import com.acme.staticforge.user.AppUser;
import com.acme.staticforge.user.SystemRole;
import com.acme.staticforge.user.UserService;
import com.acme.staticforge.user.UserStatus;
import java.time.Instant;
import java.util.Map;
import java.util.Optional;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.security.core.Authentication;
import org.springframework.security.oauth2.server.resource.InvalidBearerTokenException;
import org.springframework.security.oauth2.jwt.Jwt;

@ExtendWith(MockitoExtension.class)
class SfJwtAuthenticationConverterTest {

    @Mock UserService userService;

    SfJwtAuthenticationConverter converter;

    @BeforeEach
    void setUp() {
        converter = new SfJwtAuthenticationConverter(userService);
    }

    @Test
    void convertsClaimsToAuthenticatedUser() {
        AppUser user = new AppUser("elena", "elena@example.com", Instant.now());
        user.setDisplayName("Elena Farkas");
        user.setSystemRole(SystemRole.INSTANCE_ADMIN);
        user.setTokenEpoch(3L);
        when(userService.findById(42L)).thenReturn(Optional.of(user));

        Jwt jwt = Jwt.withTokenValue("t")
                .header("alg", "HS256")
                .subject("42")
                .claim("uid", 42L)
                .claim("preferred_username", "elena")
                .claim("name", "Elena Farkas")
                .claim("sysRole", "INSTANCE_ADMIN")
                .claim("projects", Map.of("acme_site", "EDITOR", "acme_docs", "DEVELOPER"))
                .claim("epoch", 3L)
                .build();

        Authentication auth = converter.convert(jwt);

        assertThat(auth.getPrincipal()).isInstanceOf(AuthenticatedUser.class);
        AuthenticatedUser principal = (AuthenticatedUser) auth.getPrincipal();
        assertThat(principal.id()).isEqualTo(42L);
        assertThat(principal.username()).isEqualTo("elena");
        assertThat(principal.systemRole()).isEqualTo(SystemRole.INSTANCE_ADMIN);
        assertThat(principal.projectRoles())
                .containsEntry("acme_site", ProjectRole.EDITOR)
                .containsEntry("acme_docs", ProjectRole.DEVELOPER);
        assertThat(auth.getAuthorities()).extracting(Object::toString).containsExactly("SYS_INSTANCE_ADMIN");
    }

    @Test
    void regularUserHasNoSystemAuthority() {
        AppUser user = new AppUser("bob", "bob@example.com", Instant.now());
        user.setSystemRole(SystemRole.USER);
        when(userService.findById(7L)).thenReturn(Optional.of(user));

        Jwt jwt = Jwt.withTokenValue("t")
                .header("alg", "HS256")
                .subject("7")
                .claim("uid", 7L)
                .claim("preferred_username", "bob")
                .claim("sysRole", "USER")
                .claim("projects", Map.of())
                .claim("epoch", 0L)
                .build();

        Authentication auth = converter.convert(jwt);

        assertThat(auth.getAuthorities()).isEmpty();
    }

    @Test
    void rejectsStaleTokenEpoch() {
        AppUser user = new AppUser("bob", "bob@example.com", Instant.now());
        user.setTokenEpoch(5L);
        when(userService.findById(7L)).thenReturn(Optional.of(user));

        Jwt jwt = Jwt.withTokenValue("t")
                .header("alg", "HS256")
                .subject("7")
                .claim("uid", 7L)
                .claim("epoch", 4L)
                .build();

        assertThatThrownBy(() -> converter.convert(jwt)).isInstanceOf(InvalidBearerTokenException.class);
    }

    @Test
    void rejectsDisabledUser() {
        AppUser user = new AppUser("bob", "bob@example.com", Instant.now());
        user.setStatus(UserStatus.DISABLED);
        when(userService.findById(7L)).thenReturn(Optional.of(user));

        Jwt jwt = Jwt.withTokenValue("t")
                .header("alg", "HS256")
                .subject("7")
                .claim("uid", 7L)
                .claim("epoch", 0L)
                .build();

        assertThatThrownBy(() -> converter.convert(jwt)).isInstanceOf(InvalidBearerTokenException.class);
    }
}
