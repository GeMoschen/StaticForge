package com.acme.staticforge.generate;

/**
 * Generation-stage diagnostic codes that live in the GENERATION domain (spec §18).
 * {@code GEN_CHANNEL_MISSING} is the tolerated build warning raised when a page template has
 * no channel template for an enabled channel (spec §15.4, §16.6).
 */
public final class GenerationDiagnosticCodes {

    private GenerationDiagnosticCodes() {}

    public static final String GEN_CHANNEL_MISSING = "SF-GEN-0210";

    /**
     * A planned page's content has ERROR-severity completeness findings (an empty required editor,
     * a count or length out of bounds; spec §10.5): the page is not published, other pages are.
     */
    public static final String GEN_CONTENT_INCOMPLETE = "SF-GEN-0120";
}
