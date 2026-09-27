package com.acme.staticforge.redirect;

import com.acme.staticforge.common.Problem;
import com.acme.staticforge.common.SfException;
import java.util.Locale;

/** The problem codes of the redirect registry (M30, epic decision 19: {@code SF-DOM-0190}–{@code 0194}). */
public final class RedirectProblems {

    public static final String NOT_FOUND = "SF-DOM-0190";
    public static final String DUPLICATE_SOURCE = "SF-DOM-0191";
    public static final String LOOP = "SF-DOM-0192";
    public static final String INVALID = "SF-DOM-0193";
    public static final String NO_OUTPUT = "SF-DOM-0194";

    private RedirectProblems() {}

    /** {@code 404 SF-DOM-0190}: no redirect with this id in the project. */
    public static SfException notFound(long id) {
        return new SfException(problem(404, "Not Found", NOT_FOUND, "Redirect " + id + " not found.", null));
    }

    /** {@code 409 SF-DOM-0191}: the channel and locale already redirect this source path. */
    public static SfException duplicateSource(String channel, String locale, String fromPath) {
        return new SfException(problem(409, "Conflict", DUPLICATE_SOURCE, "'" + fromPath + "' already redirects in channel '"
                + channel + "'" + (locale.isEmpty() ? "" : ", locale '" + locale + "'") + ".", "fromPath"));
    }

    /** {@code 422 SF-DOM-0192}: the redirect would lead back to its own source path. */
    public static SfException loop(String detail) {
        return unprocessable(LOOP, detail, "fromPath");
    }

    /** {@code 422 SF-DOM-0193}: an invalid source or target (a path outside the site, an unsafe scheme, …). */
    public static SfException invalid(String detail, String field) {
        return unprocessable(INVALID, detail, field);
    }

    /** {@code 422 SF-DOM-0194}: the asset has no page output in the default target's current build. */
    public static SfException noOutput(String detail) {
        return unprocessable(NO_OUTPUT, detail, "assetUuid");
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
