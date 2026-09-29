package com.acme.staticforge.urlregistry;

import com.acme.staticforge.common.Problem;
import com.acme.staticforge.common.SfException;
import java.util.Locale;

/** The problem codes of the URL registry (M32, epic decision 12: {@code SF-DOM-0200}, {@code SF-DOM-0201}). */
public final class UrlRegistryProblems {

    public static final String URL_TAKEN = "SF-DOM-0200";
    public static final String INVALID = "SF-DOM-0201";

    private UrlRegistryProblems() {}

    /** {@code 409 SF-DOM-0200}: another target (named {@code holderName}, its uid) already holds the URL here. */
    public static SfException urlTaken(String url, UrlTarget holder, String holderName) {
        String who = holderName == null || holderName.isBlank()
                ? holder.describe()
                : holder.type().name().toLowerCase(Locale.ROOT) + " '" + holderName + "'"
                        + (holder.variant().isEmpty() ? "" : " (" + holder.variant() + ")")
                        + (holder.pageNumber() > 1 ? " (page " + holder.pageNumber() + ")" : "");
        Problem problem = base(409, "Conflict", URL_TAKEN, "'" + url + "' is already the URL of " + who + ".")
                .property("field", "url")
                .property("holderType", holder.type().name())
                .property("holderUuid", holder.uuid().toString())
                .build();
        return new SfException(problem);
    }

    /** {@code 422 SF-DOM-0201}: not a valid URL for the target (empty, outside the site, the wrong file type, …). */
    public static SfException invalid(String detail, String field) {
        return new SfException(base(422, "Unprocessable Entity", INVALID, detail).property("field", field).build());
    }

    private static Problem.Builder base(int status, String title, String code, String detail) {
        return Problem.builder()
                .type("https://cms.example.com/problems/" + code.toLowerCase(Locale.ROOT))
                .title(title)
                .status(status)
                .detail(detail)
                .property("code", code);
    }
}
