package com.acme.staticforge.generate.quality;

/** Codes of the check framework itself (M30, epic decision 19); each rule owns its own {@code SF-CHK-*} code. */
public final class QualityCodes {

    private QualityCodes() {}

    /** An output could not be parsed or a rule failed on it: reported, never a failed run, never a hold-back. */
    public static final String OUTPUT_NOT_CHECKED = "SF-CHK-0001";

    /** A page held back because a quality rule configured {@code ERROR} found something on it (run PARTIAL). */
    public static final String GEN_QUALITY_CHECK_FAILED = "SF-GEN-0125";
}
