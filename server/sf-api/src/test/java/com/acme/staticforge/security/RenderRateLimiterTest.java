package com.acme.staticforge.security;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.acme.staticforge.common.SfException;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneId;
import java.time.ZoneOffset;
import org.junit.jupiter.api.Test;

/** The draft-check rate limit (M30.3.1): a sliding minute per user. */
class RenderRateLimiterTest {

    /** A clock the test moves. */
    private static final class MovingClock extends Clock {

        private Instant now = Instant.parse("2026-09-27T10:00:00Z");

        void advance(Duration by) {
            now = now.plus(by);
        }

        @Override
        public ZoneId getZone() {
            return ZoneOffset.UTC;
        }

        @Override
        public Clock withZone(ZoneId zone) {
            return this;
        }

        @Override
        public Instant instant() {
            return now;
        }
    }

    @Test
    void theLimitIsPerUserInASlidingMinute() {
        MovingClock clock = new MovingClock();
        RenderRateLimiter limiter = new RenderRateLimiter(clock, 3);

        limiter.acquireCheck(1L);
        clock.advance(Duration.ofSeconds(20));
        limiter.acquireCheck(1L);
        limiter.acquireCheck(1L);

        assertThatThrownBy(() -> limiter.acquireCheck(1L))
                .isInstanceOf(SfException.class)
                .satisfies(e -> {
                    SfException problem = (SfException) e;
                    assertThat(problem.getProblem().getStatus()).isEqualTo(429);
                    assertThat(problem.getProblem().getDetail()).isEqualTo("Too many draft checks; retry after 40s.");
                });
        assertThatCode(() -> limiter.acquireCheck(2L)).as("another user has their own window").doesNotThrowAnyException();

        // The first check leaves the window a minute after it was made; a refused one never counted.
        clock.advance(Duration.ofSeconds(40));
        assertThatCode(() -> limiter.acquireCheck(1L)).doesNotThrowAnyException();
        assertThatThrownBy(() -> limiter.acquireCheck(1L)).isInstanceOf(SfException.class);
    }

    @Test
    void aRequestWithoutAUserIsNotCounted() {
        RenderRateLimiter limiter = new RenderRateLimiter(new MovingClock(), 1);

        assertThatCode(() -> {
            limiter.acquireCheck(null);
            limiter.acquireCheck(null);
        }).doesNotThrowAnyException();
    }
}
