package com.acme.staticforge.api.dto;

import java.time.Instant;
import java.util.List;

/**
 * A generation run's log (M35.24). {@code complete}: the run ended and the log is final. {@code truncated}: the size cap
 * dropped lines (the log says so in a marker line). {@code pruned}: the run ended but has no stored log (it ended before
 * logs were kept); {@code lines} is then empty. A line's {@code files}, {@code errors} and {@code warnings} are the run's
 * counters when it was written, so the last line carries the run's current progress.
 */
public record RunLogView(List<Line> lines, boolean complete, boolean truncated, boolean pruned) {

    /** {@code level} is {@code info}, {@code warning} or {@code error}; {@code n} counts from 1. */
    public record Line(int n, Instant time, String stage, String level, String text, long files, int errors, int warnings) {}
}
