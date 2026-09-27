package com.acme.staticforge.security;

import com.acme.staticforge.common.ProblemFactory;
import com.acme.staticforge.common.SfException;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayDeque;
import java.util.Deque;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ConcurrentMap;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

/**
 * The "preview render" rate limit of spec §26.3 for the render requests that cost a full page render and more: the
 * draft check (M30.3.1) renders the page as a build would, plans the whole draft site and parses the result. Each user
 * gets at most {@code sf.preview.rate-limit.checks-per-minute} (default 60) such requests in any sliding minute; one
 * more is refused with {@code 429 SF-API-0429} and a {@code retry after} hint. The page editor asks at most once per
 * completed autosave (debounced), far below the limit; the limit stops a runaway client from monopolizing the render.
 *
 * <p>Per node and in memory, like the login limiter ({@link LoginAttemptService}): one window per user who checked, so
 * the memory is bounded by the number of users.
 */
@Service
public class RenderRateLimiter {

    private static final Duration WINDOW = Duration.ofMinutes(1);

    private final Clock clock;
    private final int checksPerMinute;
    private final ConcurrentMap<Long, Deque<Instant>> windows = new ConcurrentHashMap<>();

    public RenderRateLimiter(Clock clock, @Value("${sf.preview.rate-limit.checks-per-minute:60}") int checksPerMinute) {
        this.clock = clock;
        this.checksPerMinute = Math.max(1, checksPerMinute);
    }

    /**
     * Counts one draft check of {@code userId}.
     *
     * @throws SfException {@code 429 SF-API-0429} when the user already made the limit's worth in the last minute
     */
    public void acquireCheck(Long userId) {
        if (userId == null) {
            return; // every check endpoint is authenticated; nothing to count without a user
        }
        Instant now = clock.instant();
        Instant cutoff = now.minus(WINDOW);
        SfException refused = null;
        Deque<Instant> window = windows.computeIfAbsent(userId, id -> new ArrayDeque<>());
        synchronized (window) {
            while (!window.isEmpty() && !window.peekFirst().isAfter(cutoff)) {
                window.pollFirst();
            }
            if (window.size() >= checksPerMinute) {
                long wait = Math.max(1, Duration.between(now, window.peekFirst().plus(WINDOW)).toSeconds());
                refused = new SfException(ProblemFactory.other(429, "SF-API-0429", "Rate limit exceeded",
                        "Too many draft checks; retry after " + wait + "s."));
            } else {
                window.addLast(now);
            }
        }
        if (refused != null) {
            throw refused;
        }
    }
}
