package com.acme.staticforge.scheduler;

import com.acme.staticforge.common.Problem;
import com.acme.staticforge.common.SfException;
import java.util.Locale;

/**
 * The problem codes of the scheduler (M27.4, Appendix B {@code SF-DOM-0160}–{@code 0168}). {@code 0160},
 * {@code 0162} and {@code 0163} also name why an execution failed ({@code detail.code} of the execution).
 */
public final class SchedulerProblems {

    public static final String UNKNOWN_TYPE = "SF-DOM-0160";
    public static final String INVALID_PARAMS = "SF-DOM-0161";
    public static final String TARGET_GONE = "SF-DOM-0162";
    public static final String OWNER_NOT_PERMITTED = "SF-DOM-0163";
    public static final String TIME_IN_PAST = "SF-DOM-0164";
    public static final String INVALID_CRON = "SF-DOM-0165";
    public static final String TIMING_MISMATCH = "SF-DOM-0166";
    public static final String RUNNING = "SF-DOM-0167";
    public static final String REPIN_NOT_APPLICABLE = "SF-DOM-0168";

    private SchedulerProblems() {}

    /** {@code 422 SF-DOM-0160}: no handler for {@code type}. */
    public static SfException unknownType(String type) {
        return unprocessable(UNKNOWN_TYPE, "Unknown action type '" + type + "'.", "type");
    }

    /** {@code 422 SF-DOM-0161}: the action's parameters don't fit its type; {@code field} names the offender. */
    public static SfException invalidParams(String detail, String field) {
        return unprocessable(INVALID_PARAMS, detail, field);
    }

    /** {@code 422 SF-DOM-0164}. */
    public static SfException timeInPast() {
        return unprocessable(TIME_IN_PAST, "The time lies in the past.", "runAt");
    }

    /** {@code 422 SF-DOM-0165}: an unparsable cron expression or an unknown time zone. */
    public static SfException invalidCron(String detail, String field) {
        return unprocessable(INVALID_CRON, detail, field);
    }

    /** {@code 422 SF-DOM-0166}: a cron on a one-off type, a run time on a recurring one, or neither. */
    public static SfException timingMismatch(String detail) {
        return unprocessable(TIMING_MISMATCH, detail, null);
    }

    /** {@code 409 SF-DOM-0167}: the action is executing (or waiting inside an execution) and can't be changed now. */
    public static SfException running(String detail) {
        return new SfException(problem(409, "Conflict", RUNNING, detail, null));
    }

    /** {@code 422 SF-DOM-0168}: re-pin needs a pinned release. */
    public static SfException repinNotApplicable() {
        return unprocessable(REPIN_NOT_APPLICABLE, "Only a pinned scheduled release can be re-pinned.", null);
    }

    private static SfException unprocessable(String code, String detail, String field) {
        return new SfException(problem(422, "Unprocessable Entity", code, detail, field));
    }

    private static Problem problem(int status, String title, String code, String detail, String field) {
        Problem.Builder builder = Problem.builder()
                .type("https://cms.example.com/problems/" + code.toLowerCase(Locale.ROOT))
                .title(title)
                .status(status)
                .detail(detail)
                .property("code", code);
        if (field != null) {
            builder.property("field", field);
        }
        return builder.build();
    }
}
