package com.acme.staticforge.housekeeping;

import com.acme.staticforge.common.Problem;
import com.acme.staticforge.common.SfException;
import java.util.List;
import java.util.Locale;

/**
 * The problem codes of the system jobs (M29.1, epic decision 14, Appendix B {@code SF-DOM-0180}–{@code 0184}).
 * {@code 0182} and {@code 0183} belong to revision compaction (M29.4.1).
 */
public final class HousekeepingProblems {

    public static final String INVALID_SETTINGS = "SF-DOM-0180";
    public static final String ALREADY_RUNNING = "SF-DOM-0181";
    public static final String COMPACTION_CONFIRMATION = "SF-DOM-0182";
    public static final String COMPACTION_TOO_RECENT = "SF-DOM-0183";
    public static final String UNKNOWN_JOB = "SF-DOM-0184";

    private HousekeepingProblems() {}

    /**
     * {@code 422 SF-DOM-0180}: an invalid cron, zone or settings (or a dry run of a job without one); {@code errors}
     * holds one message per problem.
     */
    public static SfException invalidSettings(List<String> errors) {
        String detail = errors.size() == 1 ? errors.get(0) : "The job settings are invalid.";
        return new SfException(problem(422, "Unprocessable Entity", INVALID_SETTINGS, detail)
                .property("errors", List.copyOf(errors))
                .build());
    }

    /** {@code 409 SF-DOM-0181}: the job is running (on any node). */
    public static SfException alreadyRunning(String key) {
        return new SfException(problem(409, "Conflict", ALREADY_RUNNING, "Job '" + key + "' is already running.")
                .build());
    }

    /** {@code 404 SF-DOM-0184}: no job has this key, or its row is orphaned and it can't be changed or run. */
    public static SfException unknownJob(String key, String detail) {
        return new SfException(problem(404, "Not Found", UNKNOWN_JOB, detail == null ? "Unknown job '" + key + "'." : detail)
                .property("key", key)
                .build());
    }

    /**
     * {@code 422 SF-DOM-0182}: enabling revision compaction, or lowering its {@code olderThanDays}, needs
     * {@code confirm} equal to the project key; it was missing or wrong.
     */
    public static SfException compactionConfirmationRequired(String projectKey) {
        return new SfException(problem(422, "Unprocessable Entity", COMPACTION_CONFIRMATION,
                        "Compacting history removes old versions for good: confirm with the project key '" + projectKey
                                + "'.")
                .property("projectKey", projectKey)
                .build());
    }

    /** {@code 422 SF-DOM-0183}: {@code olderThanDays} is below the minimum. */
    public static SfException compactionTooRecent(int olderThanDays, int minimum) {
        return new SfException(problem(422, "Unprocessable Entity", COMPACTION_TOO_RECENT,
                        "Only history older than " + minimum + " days can be compacted (got " + olderThanDays + ").")
                .property("minimum", minimum)
                .build());
    }

    private static Problem.Builder problem(int status, String title, String code, String detail) {
        return Problem.builder()
                .type("https://cms.example.com/problems/" + code.toLowerCase(Locale.ROOT))
                .title(title)
                .status(status)
                .detail(detail)
                .property("code", code);
    }
}
