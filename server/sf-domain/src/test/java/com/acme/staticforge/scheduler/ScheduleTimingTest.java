package com.acme.staticforge.scheduler;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.acme.staticforge.common.SfException;
import java.time.Instant;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.time.ZonedDateTime;
import java.util.List;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/** Cron slots in a time zone across DST changes (M27.4.1, epic decision 24). */
class ScheduleTimingTest {

    private static final ZoneId BERLIN = ZoneId.of("Europe/Berlin");

    @Test
    @DisplayName("a skipped local time runs once at the first valid instant after the gap (spring forward)")
    void springForward() {
        // 2026-03-29: 02:00 CET jumps to 03:00 CEST — 02:30 doesn't exist.
        Instant before = local(2026, 3, 29, 1, 0);
        Instant slot = ScheduleTiming.nextAfter("0 30 2 * * *", BERLIN, before);
        assertThat(slot.atZone(BERLIN).toLocalDateTime()).isEqualTo(LocalDateTime.of(2026, 3, 29, 3, 0));
        assertThat(slot).isEqualTo(Instant.parse("2026-03-29T01:00:00Z"));
        // Once only: the next slot is the next day's 02:30.
        Instant next = ScheduleTiming.nextAfter("0 30 2 * * *", BERLIN, slot);
        assertThat(next.atZone(BERLIN).toLocalDateTime()).isEqualTo(LocalDateTime.of(2026, 3, 30, 2, 30));
    }

    @Test
    @DisplayName("a repeated local time runs once, at its first occurrence (fall back)")
    void fallBack() {
        // 2026-10-25: 03:00 CEST falls back to 02:00 CET — 02:30 exists twice.
        Instant before = local(2026, 10, 25, 1, 0);
        Instant slot = ScheduleTiming.nextAfter("0 30 2 * * *", BERLIN, before);
        assertThat(slot).isEqualTo(Instant.parse("2026-10-25T00:30:00Z"));
        Instant next = ScheduleTiming.nextAfter("0 30 2 * * *", BERLIN, slot);
        assertThat(next).isEqualTo(Instant.parse("2026-10-26T01:30:00Z"));
        // Evaluated from inside the repeated hour, the second 02:30 isn't a slot either.
        Instant secondPass = ScheduleTiming.nextAfter("0 30 2 * * *", BERLIN, Instant.parse("2026-10-25T01:10:00Z"));
        assertThat(secondPass).isEqualTo(Instant.parse("2026-10-26T01:30:00Z"));
    }

    @Test
    @DisplayName("a daily 03:00 cron stays at 03:00 local across both switches")
    void dailyAcrossSwitches() {
        List<Instant> slots = ScheduleTiming.next("0 0 3 * * *", BERLIN, local(2026, 3, 28, 12, 0), 3);
        assertThat(slots).extracting(i -> i.atZone(BERLIN).toLocalDateTime()).containsExactly(
                LocalDateTime.of(2026, 3, 29, 3, 0), LocalDateTime.of(2026, 3, 30, 3, 0), LocalDateTime.of(2026, 3, 31, 3, 0));
        assertThat(slots.get(0)).isEqualTo(Instant.parse("2026-03-29T01:00:00Z"));
        assertThat(slots.get(1)).isEqualTo(Instant.parse("2026-03-30T01:00:00Z"));
        List<Instant> autumn = ScheduleTiming.next("0 0 3 * * *", BERLIN, local(2026, 10, 24, 12, 0), 2);
        assertThat(autumn).containsExactly(Instant.parse("2026-10-25T02:00:00Z"), Instant.parse("2026-10-26T02:00:00Z"));
    }

    @Test
    @DisplayName("five-field crons get zero seconds; macros are accepted; garbage and unknown zones are 422 SF-DOM-0165")
    void normalizeAndValidate() {
        assertThat(ScheduleTiming.normalizeCron("30 2 * * *")).isEqualTo("0 30 2 * * *");
        assertThat(ScheduleTiming.normalizeCron("  0   30 2 * * MON-FRI ")).isEqualTo("0 30 2 * * MON-FRI");
        assertThat(ScheduleTiming.normalizeCron("@daily")).isEqualTo("@daily");
        assertThatThrownBy(() -> ScheduleTiming.normalizeCron("every day"))
                .isInstanceOf(SfException.class)
                .satisfies(e -> assertThat(((SfException) e).getProblem().getExtensions()).containsEntry("code", "SF-DOM-0165"));
        assertThatThrownBy(() -> ScheduleTiming.zone("Mars/Olympus"))
                .isInstanceOf(SfException.class)
                .satisfies(e -> assertThat(((SfException) e).getProblem().getExtensions()).containsEntry("code", "SF-DOM-0165"));
        assertThat(ScheduleTiming.nextAfter("0 0 0 30 2 *", BERLIN, Instant.parse("2026-01-01T00:00:00Z"))).isNull();
    }

    private static Instant local(int year, int month, int day, int hour, int minute) {
        return ZonedDateTime.of(year, month, day, hour, minute, 0, 0, BERLIN).toInstant();
    }
}
