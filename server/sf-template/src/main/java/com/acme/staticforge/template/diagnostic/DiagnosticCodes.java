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
    public static final String OCTL_GLOBAL_REFERENCE_MISUSE = "SF-TPL-0105";
    public static final String OCTL_UNRESOLVABLE_REF = "SF-TPL-0110";
    public static final String OCTL_BODY_IN_SECTION = "SF-TPL-0120";
    /** {@code $CMS_BODY}, {@code $CMS_INCLUDE}, leaf {@code $CMS_NAVIGATION} or {@code CMS_PAGE} in a processed text media file (M18.2.1). */
    public static final String OCTL_NOT_ALLOWED_IN_TEXT_MEDIA = "SF-TPL-0121";
    public static final String OCTL_UNKNOWN_NAV_VARIABLE = "SF-TPL-0134";

    // OCTL render limits (§16.10) — carried by RenderLimitException, fail only the affected file
    public static final String OCTL_INCLUDE_DEPTH = "SF-TPL-0130";
    public static final String OCTL_LOOP_LIMIT = "SF-TPL-0131";
    public static final String OCTL_OUTPUT_LIMIT = "SF-TPL-0132";
    public static final String OCTL_TIME_BUDGET = "SF-TPL-0133";
    public static final String OCTL_INCLUDE_CYCLE = "SF-TPL-0135";

    // OCTL warnings (§16.11)
    /** A cross-asset {@code $CMS_VALUE(assetType:uid)$} with no editor path (stringifies the whole value object). */
    public static final String OCTL_CROSS_ASSET_VALUE_WITHOUT_PATH = "SF-TPL-0111";
    /** Render-time: a cross-asset value's target resolved at compile time but is now missing or soft-deleted (renders empty). */
    public static final String OCTL_MISSING_VALUE_TARGET = "SF-TPL-0112";
    public static final String OCTL_BODY_NEVER_RENDERED = "SF-TPL-0201";
    public static final String OCTL_RAW_ON_TEXT = "SF-TPL-0301";
    public static final String OCTL_EDITOR_NEVER_USED = "SF-TPL-0310";
    /** Text media: a {@code $$} in the source is output as a single {@code $} once processing is on (M18.2.1). */
    public static final String OCTL_TEXT_MEDIA_DOLLAR_ESCAPE = "SF-TPL-0320";
    /** Text media: a {@code $CMS_VALUE} without an escaping filter in a JS/JSON file (M18.2.1). */
    public static final String OCTL_TEXT_MEDIA_UNESCAPED_VALUE = "SF-TPL-0321";

    // CDL
    public static final String CDL_DUPLICATE_EDITOR = "SF-CDL-0101";
    public static final String CDL_RESERVED_NAME = "SF-CDL-0102";
    public static final String CDL_UNKNOWN_EDITOR_TYPE = "SF-CDL-0103";
    public static final String CDL_INVALID_ATTRIBUTE = "SF-CDL-0104";
    public static final String CDL_INVALID_EXPRESSION = "SF-CDL-0105";
    public static final String CDL_INVALID_NAME = "SF-CDL-0106";
    public static final String CDL_NOT_ALLOWED_IN_GLOBAL_SET = "SF-CDL-0107";
    public static final String CDL_SYNTAX = "SF-CDL-0200";
}
