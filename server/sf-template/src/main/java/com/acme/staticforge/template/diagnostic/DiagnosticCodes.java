package com.acme.staticforge.template.diagnostic;

/**
 * Stable diagnostic codes. OCTL codes match spec §16.11; CDL codes use the {@code SF-CDL}
 * prefix (the spec does not enumerate CDL codes explicitly).
 */
public final class DiagnosticCodes {

    private DiagnosticCodes() {}

    // OCTL compile/parse errors (§16.11)
    public static final String OCTL_UNKNOWN_INSTRUCTION = "SF-TPL-0101";
    public static final String OCTL_UNBALANCED_BLOCK = "SF-TPL-0102";
    public static final String OCTL_UNKNOWN_EDITOR = "SF-TPL-0103";
    public static final String OCTL_UNKNOWN_FILTER = "SF-TPL-0104";
    public static final String OCTL_UNRESOLVABLE_REF = "SF-TPL-0110";
    public static final String OCTL_BODY_IN_SECTION = "SF-TPL-0120";

    // OCTL warnings (§16.11)
    public static final String OCTL_BODY_NEVER_RENDERED = "SF-TPL-0201";
    public static final String OCTL_RAW_ON_TEXT = "SF-TPL-0301";
    public static final String OCTL_EDITOR_NEVER_USED = "SF-TPL-0310";

    // CDL
    public static final String CDL_DUPLICATE_EDITOR = "SF-CDL-0101";
    public static final String CDL_RESERVED_NAME = "SF-CDL-0102";
    public static final String CDL_UNKNOWN_EDITOR_TYPE = "SF-CDL-0103";
    public static final String CDL_INVALID_ATTRIBUTE = "SF-CDL-0104";
    public static final String CDL_INVALID_EXPRESSION = "SF-CDL-0105";
    public static final String CDL_INVALID_NAME = "SF-CDL-0106";
    public static final String CDL_SYNTAX = "SF-CDL-0200";
}
