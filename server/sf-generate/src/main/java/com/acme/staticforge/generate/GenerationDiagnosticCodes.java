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

    /**
     * {@code $CMS_REF}, {@code $CMS_INCLUDE} or a body/catalog section resolves to a soft-deleted asset
     * (spec §16.4): tolerated build warning, the reference renders empty. Values read from a deleted
     * target report {@code SF-TPL-0112} instead.
     */
    public static final String GEN_DELETED_REFERENCE = "SF-GEN-0220";

    /**
     * A processed text media file's source blob can't be read (M18.3.1): the file is not published,
     * the run is PARTIAL. Compile and render failures of processed media keep their own
     * {@code SF-TPL-*} code, with the media uid in the message.
     */
    public static final String GEN_MEDIA_SOURCE_MISSING = "SF-GEN-0230";
}
