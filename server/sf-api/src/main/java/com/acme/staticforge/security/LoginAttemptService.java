package com.acme.staticforge.security;

import com.acme.staticforge.common.ProblemFactory;
import com.acme.staticforge.common.SfException;
import com.acme.staticforge.user.AppUser;
import com.acme.staticforge.user.AppUserRepository;
import com.acme.staticforge.user.UserStatus;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayDeque;
import java.util.Deque;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ConcurrentMap;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Login rate limiting and account lockout (spec §9.4).
 *
 * <p>Two independent guards:
 *
 * <ul>
 *   <li><b>Per-(IP, username) rate limit</b>: at most 10 attempts within 5 minutes, after
 *       which further attempts are blocked with exponential backoff. Kept in a {@link
 *       ConcurrentHashMap}; this is deliberately per-node (see below).
 *   <li><b>Account lockout</b>: persisted {@code failedLogins} counter on {@link AppUser};
 *       after 15 failures the account is {@code LOCKED} until admin unlock or 30 minutes
 *       ({@code lockedUntil}).
 * </ul>
 *
 * <p>The in-memory limiter is per-node and resets on restart; a distributed rate limiter is
 * a documented follow-up.
 */
@Service
public class LoginAttemptService {

    private static final int MAX_ATTEMPTS_PER_WINDOW = 10;
    private static final Duration WINDOW = Duration.ofMinutes(5);
    private static final long BASE_BACKOFF_SECONDS = 60L;

    private static final int ACCOUNT_LOCK_THRESHOLD = 15;
    private static final Duration ACCOUNT_LOCK_DURATION = Duration.ofMinutes(30);

    private final AppUserRepository appUsers;
    private final Clock clock;

    private final ConcurrentMap<String, Bucket> buckets = new ConcurrentHashMap<>();

    public LoginAttemptService(AppUserRepository appUsers, Clock clock) {
        this.appUsers = appUsers;
        this.clock = clock;
    }

    /** Throws a 429 problem when (IP, username) is currently rate limited. */
    public void checkRateLimit(String key) {
        Bucket bucket = buckets.get(key);
        if (bucket == null) {
            return;
        }
        synchronized (bucket) {
            prune(bucket, clock.instant());
            if (bucket.blockUntil != null && bucket.blockUntil.isAfter(clock.instant())) {
                throw tooManyRequests(bucket.blockUntil);
            }
        }
    }

    /** Records a failed attempt for the (IP, username) key and applies backoff past the limit. */
    public void recordIpFailure(String key) {
        Instant now = clock.instant();
        Bucket bucket = buckets.computeIfAbsent(key, k -> new Bucket());
        synchronized (bucket) {
            prune(bucket, now);
            bucket.attempts.addLast(now);
            int count = bucket.attempts.size();
            if (count >= MAX_ATTEMPTS_PER_WINDOW) {
                long exponent = Math.min(count - MAX_ATTEMPTS_PER_WINDOW, 5L);
                Instant candidate = now.plusSeconds(BASE_BACKOFF_SECONDS << exponent);
                if (bucket.blockUntil == null || candidate.isAfter(bucket.blockUntil)) {
                    bucket.blockUntil = candidate;
                }
            }
        }
    }

    /** Clears the rate-limit state on a successful login. */
    public void recordIpSuccess(String key) {
        buckets.remove(key);
    }

    /** Increments the account's failure counter, locking it once the threshold is crossed. */
    @Transactional
    public void registerAccountFailure(AppUser user) {
        int failures = user.getFailedLogins() + 1;
        user.setFailedLogins(failures);
        if (failures >= ACCOUNT_LOCK_THRESHOLD) {
            user.setStatus(UserStatus.LOCKED);
            user.setLockedUntil(clock.instant().plus(ACCOUNT_LOCK_DURATION));
        }
        appUsers.save(user);
    }

    /** Resets the failure counter and records the login time on success. */
    @Transactional
    public void registerAccountSuccess(AppUser user) {
        user.setFailedLogins(0);
        user.setLockedUntil(null);
        if (user.getStatus() == UserStatus.LOCKED) {
            user.setStatus(UserStatus.ACTIVE);
        }
        user.setLastLoginAt(clock.instant());
        appUsers.save(user);
    }

    void clear() {
        buckets.clear();
    }

    private void prune(Bucket bucket, Instant now) {
        Instant cutoff = now.minus(WINDOW);
        while (!bucket.attempts.isEmpty() && bucket.attempts.peekFirst().isBefore(cutoff)) {
            bucket.attempts.pollFirst();
        }
        if (bucket.blockUntil != null && !bucket.blockUntil.isAfter(now)) {
            bucket.blockUntil = null;
        }
    }

    private static SfException tooManyRequests(Instant blockUntil) {
        long waitSeconds = Math.max(0, Duration.between(Instant.now(), blockUntil).getSeconds());
        return new SfException(ProblemFactory.other(
                429, "SF-API-0429", "Rate limit exceeded", "Too many login attempts; retry after " + waitSeconds + "s."));
    }

    private static final class Bucket {
        final Deque<Instant> attempts = new ArrayDeque<>();
        Instant blockUntil;
    }
}
