package com.acme.staticforge.api.dto;

import java.time.Instant;
import java.util.Map;

/**
 * The findings per rule of the project's last finished run on its default target (M35.24): {@code run} is that run
 * ({@code SUCCESS} or {@code PARTIAL}) and {@code counts} maps each rule code that has findings to its count (a rule
 * missing from it has none). Both are {@code null} when no run has finished yet.
 */
public record QualityLastRunView(LastRun run, Map<String, Long> counts) {

    /**
     * @param findingErrors findings with severity {@code ERROR} over the whole run, stored or not
     * @param findingWarnings findings with severity {@code WARNING} over the whole run, stored or not
     * @param truncated findings the storage caps dropped: {@code counts} covers the stored ones only
     */
    public record LastRun(
            long id,
            String status,
            Instant finishedAt,
            Long targetId,
            int findingErrors,
            int findingWarnings,
            int truncated) {}
}
