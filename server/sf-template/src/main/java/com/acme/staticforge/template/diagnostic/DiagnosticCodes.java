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
    /** A dataset loop's query arguments are invalid: unknown argument, bad {@code where}/{@code sort}, negative {@code limit} (M19.3.1). */
    public static final String OCTL_DATASET_QUERY = "SF-TPL-0140";
    /** A dataset loop's {@code where}/{@code sort} names a field the dataset does not declare (M19.3.1; checked on template save). */
    public static final String OCTL_DATASET_UNKNOWN_FIELD = "SF-TPL-0141";
    /** A dataset loop sorts by an editor with no natural order (list, richtext, reference, …) (M19.3.1). */
    public static final String OCTL_DATASET_UNSORTABLE_FIELD = "SF-TPL-0142";

    // OCTL template inheritance (M20). The epic proposed 0140–0149, which M19 had already taken.
    /** {@code $CMS_EXTENDS} is not the template's first instruction, is nested, or appears more than once. */
    public static final String OCTL_EXTENDS_POSITION = "SF-TPL-0150";
    /** A template that extends has text or an instruction other than a block, {@code $CMS_SET} or a comment outside its top-level blocks. */
    public static final String OCTL_CONTENT_OUTSIDE_BLOCK = "SF-TPL-0151";
    /** A block name is not an identifier, or is declared twice in one template (nested blocks included). */
    public static final String OCTL_BLOCK_NAME = "SF-TPL-0152";
    /** {@code $CMS_PARENT$} outside a block, in a template that does not extend, or with arguments. */
    public static final String OCTL_PARENT_MISUSE = "SF-TPL-0153";
    /** The {@code $CMS_EXTENDS} chain returns to a template already in it. */
    public static final String OCTL_INHERITANCE_CYCLE = "SF-TPL-0154";
    /** The {@code $CMS_EXTENDS} chain is deeper than {@code OctlCompiler.MAX_INHERITANCE_DEPTH}. */
    public static final String OCTL_INHERITANCE_DEPTH = "SF-TPL-0155";
    /** {@code $CMS_EXTENDS} names something other than a {@code page_template:uid}, or is used in a section template. */
    public static final String OCTL_EXTENDS_TARGET = "SF-TPL-0156";
    /** Warning: a template overrides a block that no ancestor defines (usually a typo). */
    public static final String OCTL_UNKNOWN_BLOCK_OVERRIDE = "SF-TPL-0157";
    /** An ancestor has no template for the channel being compiled. */
    public static final String OCTL_ANCESTOR_MISSING_CHANNEL = "SF-TPL-0158";
    /** A page template's channels extend different parents. */
    public static final String OCTL_CHANNELS_EXTEND_DIFFERENT_PARENTS = "SF-TPL-0159";
    /** An ancestor's own source has compile errors (reported once on the descendant). */
    public static final String OCTL_ANCESTOR_INVALID = "SF-TPL-0160";
    /** The parent can't be loaded here: no loader in this context, or it is not a live page template. */
    public static final String OCTL_PARENT_UNAVAILABLE = "SF-TPL-0161";
    /** A block contains itself, through nested blocks or overrides along the chain. */
    public static final String OCTL_BLOCK_RECURSION = "SF-TPL-0162";

    // Pagination (M21.3.1)
    /** {@code CMS_PAGINATION} is read-only: a {@code $CMS_SET} or loop variable can't take its name. */
    public static final String OCTL_PAGINATION_READ_ONLY = "SF-TPL-0163";

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
    /** A dataset schema declares bodies: records have values only, no sections (M19.1.2). */
    public static final String CDL_NOT_ALLOWED_IN_DATASET = "SF-CDL-0108";
    /** A template's own editor or body name collides with one it inherits from an ancestor (M20). */
    public static final String CDL_INHERITED_NAME_COLLISION = "SF-CDL-0109";
    /** A {@code pagination} editor inside a {@code list}/{@code group}, or in a section template, property set or dataset schema (M21.1.1). */
    public static final String CDL_PAGINATION_PLACEMENT = "SF-CDL-0110";
    /** A page template declares, or declares and inherits, more than one {@code pagination} editor (M21.1.1). */
    public static final String CDL_PAGINATION_DUPLICATE = "SF-CDL-0111";
    public static final String CDL_SYNTAX = "SF-CDL-0200";
}
