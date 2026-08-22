package com.acme.staticforge.security;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.acme.staticforge.common.SfException;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.Optional;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

@ExtendWith(MockitoExtension.class)
class RefreshTokenServiceTest {

    @Mock RefreshTokenRepository repository;

    private RefreshTokenService service;

    private static final Instant NOW = Instant.parse("2024-01-01T00:00:00Z");

    @BeforeEach
    void setUp() {
        JwtProperties properties = new JwtProperties();
        properties.setRefreshTokenTtl(Duration.ofHours(8));
        properties.setRefreshTokenAbsoluteTtl(Duration.ofDays(30));
        service = new RefreshTokenService(repository, properties, Clock.fixed(NOW, ZoneOffset.UTC));
    }

    @Test
    void issueCreatesFamilyWithSlidingAndAbsoluteExpiry() {
        when(repository.save(any())).thenAnswer(inv -> inv.getArgument(0));

        RefreshToken token = service.issue(42L);

        assertThat(token.getUserId()).isEqualTo(42L);
        assertThat(token.getFamilyId()).isNotBlank();
        assertThat(token.getToken()).isNotBlank();
        assertThat(token.isRevoked()).isFalse();
        assertThat(token.getExpiresAt()).isEqualTo(NOW.plus(Duration.ofHours(8)));
        assertThat(token.getAbsoluteExpiresAt()).isEqualTo(NOW.plus(Duration.ofDays(30)));
    }

    @Test
    void rotateMarksPresentedRevokedAndIssuesSameFamily() {
        RefreshToken presented = token("family-1", false, NOW.plus(Duration.ofHours(4)), NOW.plus(Duration.ofDays(30)));
        when(repository.findByToken("presented")).thenReturn(Optional.of(presented));
        when(repository.save(any())).thenAnswer(inv -> inv.getArgument(0));

        RefreshToken rotated = service.rotate("presented");

        assertThat(presented.isRevoked()).isTrue();
        assertThat(rotated.getFamilyId()).isEqualTo("family-1");
        assertThat(rotated.getToken()).isNotEqualTo("presented");
        assertThat(rotated.getExpiresAt()).isEqualTo(NOW.plus(Duration.ofHours(8)));
    }

    @Test
    void rotateReuseRevokesWholeFamilyAndThrows401() {
        RefreshToken presented = token("family-1", true, NOW.plus(Duration.ofHours(4)), NOW.plus(Duration.ofDays(30)));
        when(repository.findByToken("presented")).thenReturn(Optional.of(presented));

        assertThatThrownBy(() -> service.rotate("presented"))
                .isInstanceOf(SfException.class)
                .extracting(e -> ((SfException) e).getStatus())
                .isEqualTo(401);

        verify(repository).deleteByFamilyId("family-1");
    }

    @Test
    void rotateExpiredTokenThrows401() {
        RefreshToken presented = token("family-1", false, NOW.minus(Duration.ofMinutes(1)), NOW.plus(Duration.ofDays(30)));
        when(repository.findByToken("presented")).thenReturn(Optional.of(presented));

        assertThatThrownBy(() -> service.rotate("presented"))
                .isInstanceOf(SfException.class)
                .extracting(e -> ((SfException) e).getStatus())
                .isEqualTo(401);

        verify(repository).deleteByFamilyId("family-1");
    }

    @Test
    void revokeFamilyDeletesFamily() {
        RefreshToken presented = token("family-1", false, NOW.plus(Duration.ofHours(4)), NOW.plus(Duration.ofDays(30)));
        when(repository.findByToken("presented")).thenReturn(Optional.of(presented));

        service.revokeFamily("presented");

        verify(repository).deleteByFamilyId("family-1");
    }

    private static RefreshToken token(String family, boolean revoked, Instant expiresAt, Instant absolute) {
        RefreshToken token = new RefreshToken(42L, family, "token-" + family, NOW, expiresAt, absolute);
        token.setRevoked(revoked);
        return token;
    }
}
