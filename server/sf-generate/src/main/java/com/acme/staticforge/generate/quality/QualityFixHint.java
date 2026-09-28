package com.acme.staticforge.generate.quality;

/**
 * Where a rule's findings are usually fixed (M30, rule catalogue): the settings UI and the findings list say "fix in
 * content" or "fix in template" from it. The rule's {@link QualityRule#description()} explains the case in words.
 */
public enum QualityFixHint {
    /** An editor fixes it in the content: alt text on the media, the text of a link in a rich-text field. */
    CONTENT,
    /** A developer fixes it in the template: the markup is hard-coded there (the document language, a form). */
    TEMPLATE,
    /** Either, depending on where the element comes from — the description says how to tell. */
    CONTENT_OR_TEMPLATE
}
