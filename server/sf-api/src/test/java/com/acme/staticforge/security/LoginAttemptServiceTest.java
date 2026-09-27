package com.acme.staticforge.security;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.acme.staticforge.common.SfException;
import com.acme.staticforge.user.AppUser;
import com.acme.staticforge.user.AppUserRepository;
import com.acme.staticforge.user.UserStatus;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

@ExtendWith(MockitoExtension.class)
class LoginAttemptServiceTest {

    @Mock AppUserRepository appUsers;

    private LoginAttemptService service;

    @BeforeEach
    void setUp() {
        service = new LoginAttemptService(appUsers, Clock.fixed(Instant.parse("2024-01-01T00:00:00Z"), ZoneOffset.UTC));
    }

    @Test
    void allowsRequestsUnderTheWindowLimit() {
        for (int i = 0; i < 9; i++) {
            service.recordIpFailure("1.2.3.4:alice");
            service.checkRateLimit("1.2.3.4:alice");
        }
    }

    @Test
    void rateLimitsAfterTenFailuresWithinWindow() {
        for (int i = 0; i < 10; i++) {
            service.recordIpFailure("1.2.3.4:alice");
        }
        assertThatThrownBy(() -> service.checkRateLimit("1.2.3.4:alice"))
                .isInstanceOf(SfException.class)
                .extracting(e -> ((SfException) e).getStatus())
                .isEqualTo(429);
    }

    @Test
    void successClearsFailures() {
        for (int i = 0; i < 10; i++) {
            service.recordIpFailure("1.2.3.4:alice");
        }
        service.recordIpSuccess("1.2.3.4:alice");
        service.checkRateLimit("1.2.3.4:alice");
    }

    @Test
    void locksAccountAfterFifteenFailures() {
        AppUser user = new AppUser("bob", "bob@example.com", Instant.now());
        when(appUsers.save(any())).thenAnswer(inv -> inv.getArgument(0));

        for (int i = 0; i < 15; i++) {
            service.registerAccountFailure(user);
        }

        assertThat(user.getFailedLogins()).isEqualTo(15);
        assertThat(user.getStatus()).isEqualTo(UserStatus.LOCKED);
        assertThat(user.getLockedUntil()).isEqualTo(Instant.parse("2024-01-01T00:30:00Z"));
        verify(appUsers, times(15)).save(user);
    }

    @Test
    void successResetsFailureCounterAndRecordsLogin() {
        AppUser user = new AppUser("bob", "bob@example.com", Instant.now());
        user.setFailedLogins(3);
        user.setStatus(UserStatus.LOCKED);
        user.setLockedUntil(Instant.now().plus(Duration.ofMinutes(5)));

        service.registerAccountSuccess(user);

        assertThat(user.getFailedLogins()).isZero();
        assertThat(user.getLockedUntil()).isNull();
        assertThat(user.getStatus()).isEqualTo(UserStatus.ACTIVE);
        assertThat(user.getLastLoginAt()).isEqualTo(Instant.parse("2024-01-01T00:00:00Z"));
        verify(appUsers).save(user);
    }

    @Test
    void doesNotLockIfBelowThreshold() {
        AppUser user = new AppUser("bob", "bob@example.com", Instant.now());

        for (int i = 0; i < 14; i++) {
            service.registerAccountFailure(user);
        }

        assertThat(user.getFailedLogins()).isEqualTo(14);
        assertThat(user.getStatus()).isNotEqualTo(UserStatus.LOCKED);
        assertThat(user.getLockedUntil()).isNull();
    }

    @Test
    void evictionEmptiesTheLimiterOfIdleKeys() {
        MutableTime time = new MutableTime(Instant.parse("2024-01-01T00:00:00Z"));
        LoginAttemptService limiter = new LoginAttemptService(appUsers, time);
        for (int i = 0; i < 10_000; i++) {
            limiter.recordIpFailure("10.0." + (i / 256) + "." + (i % 256) + ":user" + i);
        }
        assertThat(limiter.size()).isEqualTo(10_000);

        // Still inside the window: nothing is idle yet.
        assertThat(limiter.evictIdle(time.instant().plus(Duration.ofMinutes(4)))).isZero();
        assertThat(limiter.evictIdle(time.instant().plus(Duration.ofMinutes(5)).plusSeconds(1))).isEqualTo(10_000);
        assertThat(limiter.size()).isZero();
    }

    @Test
    void aBlockedKeySurvivesEvictionUntilItsBlockEnds() {
        MutableTime time = new MutableTime(Instant.parse("2024-01-01T00:00:00Z"));
        LoginAttemptService limiter = new LoginAttemptService(appUsers, time);
        for (int i = 0; i < 15; i++) {
            limiter.recordIpFailure("1.2.3.4:mallory");
        }
        // 15 failures: blocked for 60s << 5 = 32 minutes, far past the 5-minute window.
        Instant windowPassed = time.instant().plus(Duration.ofMinutes(6));
        assertThat(limiter.evictIdle(windowPassed)).isZero();
        time.set(windowPassed);
        assertThatThrownBy(() -> limiter.checkRateLimit("1.2.3.4:mallory")).isInstanceOf(SfException.class);

        assertThat(limiter.evictIdle(Instant.parse("2024-01-01T00:33:00Z"))).isEqualTo(1);
        assertThat(limiter.size()).isZero();
        time.set(Instant.parse("2024-01-01T00:33:00Z"));
        limiter.checkRateLimit("1.2.3.4:mallory");
    }

    /** A clock the test moves. */
    private static final class MutableTime extends Clock {
        private Instant now;

        MutableTime(Instant now) {
            this.now = now;
        }

        void set(Instant instant) {
            now = instant;
        }

        @Override
        public ZoneOffset getZone() {
            return ZoneOffset.UTC;
        }

        @Override
        public Clock withZone(java.time.ZoneId zone) {
            return this;
        }

        @Override
        public Instant instant() {
            return now;
        }
    }
}
