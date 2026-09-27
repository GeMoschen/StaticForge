package com.acme.staticforge.api.dto;

import com.acme.staticforge.asset.content.ContentIssue;
import java.util.List;

/**
 * The checks of a page's draft (M30.3.1, epic decision 13): what the page editor's Issues panel lists.
 *
 * @param completeness the page's content findings — the same {@code issues} a page response carries
 * @param findings the quality check findings on the draft render, page rules first, then the link rules; empty when
 *     the channel isn't HTML
 * @param checkedChannel the channel checked
 * @param checkedLocale the language checked; {@code null} in a project without locales
 * @param checkedPage the page number checked (a paginated page's, clamped to its page count; else {@code 1})
 * @param skippedRules the codes of the enabled rules the draft check didn't run, or ran only in part
 *     ({@code SF-CHK-0107}: anchors on the page itself only) — every enabled rule when the channel isn't HTML
 */
public record DraftCheckView(
        List<ContentIssue> completeness,
        List<DraftFindingView> findings,
        String checkedChannel,
        String checkedLocale,
        int checkedPage,
        List<String> skippedRules) {

    /**
     * One finding on the draft.
     *
     * @param name the rule's name ("Image without alt attribute")
     * @param category {@code LINKS}, {@code SEO} or {@code ACCESSIBILITY}
     * @param severity the configured severity: {@code WARNING} or {@code ERROR}
     * @param fixHint where it is usually fixed: {@code CONTENT}, {@code TEMPLATE} or {@code CONTENT_OR_TEMPLATE}
     * @param selector a CSS selector of the element in the rendered page; {@code null} for the whole page or a reference
     *     that rendered nothing
     * @param sectionInstanceId the section instance that rendered the element; {@code null} outside every section
     * @param editorPath the field of the page's content to fix ({@code bodies.main[1].content.image}); {@code null} when
     *     not known
     */
    public record DraftFindingView(
            String code,
            String name,
            String category,
            String severity,
            String fixHint,
            String message,
            String selector,
            String sectionInstanceId,
            String editorPath) {}
}
