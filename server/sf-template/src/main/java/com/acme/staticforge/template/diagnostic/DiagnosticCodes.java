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
    public static final String OCTL_UNKNOWN_NAV_VARIABLE = "SF-TPL-0134";

    // OCTL warnings (§16.11)
    /** A cross-asset {@code $CMS_VALUE(assetType:uid)$} with no editor path (stringifies the whole value object). */
    public static final String OCTL_CROSS_ASSET_VALUE_WITHOUT_PATH = "SF-TPL-0111";
    /** Render-time: a cross-asset value's target resolved at compile time but is now missing or soft-deleted (renders empty). */
    public static final String OCTL_MISSING_VALUE_TARGET = "SF-TPL-0112";
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
