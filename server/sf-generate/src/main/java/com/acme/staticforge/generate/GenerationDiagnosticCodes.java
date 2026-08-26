package com.acme.staticforge.generate;

/**
 * Generation-stage diagnostic codes that live in the GENERATION domain (spec §18).
 * {@code GEN_CHANNEL_MISSING} is the tolerated build warning raised when a page template has
 * no channel template for an enabled channel (spec §15.4, §16.6).
 */
public final class GenerationDiagnosticCodes {

    private GenerationDiagnosticCodes() {}

    public static final String GEN_CHANNEL_MISSING = "SF-GEN-0210";
}
