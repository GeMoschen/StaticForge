package com.acme.staticforge.search;

import com.acme.staticforge.common.ProblemFactory;
import com.acme.staticforge.common.SfException;

/** The search problem codes (M23, spec Appendix B). */
public final class SearchProblems {

    /** Invalid search parameters: {@code q} missing or too long, unknown {@code type}, {@code size} out of range. */
    public static final String BAD_REQUEST = "SF-SEARCH-0400";

    /** A reindex was requested while one is already running for the project. */
    public static final String CONFLICT = "SF-SEARCH-0409";

    /** The project's index can't be opened, e.g. another instance holds its write lock. */
    public static final String UNAVAILABLE = "SF-SEARCH-0503";

    private SearchProblems() {}

    public static SfException badRequest(String detail) {
        return new SfException(ProblemFactory.of(400, BAD_REQUEST, "Invalid Search", detail));
    }

    public static SfException reindexRunning() {
        return new SfException(ProblemFactory.of(
                409, CONFLICT, "Reindex Already Running", "A search index rebuild is already running for this project."));
    }

    public static SfException unavailable() {
        return new SfException(ProblemFactory.of(
                503,
                UNAVAILABLE,
                "Search Unavailable",
                "The search index is unavailable. Search needs exclusive access to its index directory; check that no"
                        + " second instance uses the same index root."));
    }
}
