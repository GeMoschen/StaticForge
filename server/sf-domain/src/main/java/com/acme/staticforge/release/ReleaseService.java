package com.acme.staticforge.release;

import com.acme.staticforge.revision.RevisionContext;
import java.util.List;

/**
 * Changes release state (M27.1.2): release, unpublish and discard, each one revision, plus the dry run that proposes
 * dependencies. Every mutation checks {@link ReleasePermissionCheck} with the context's user and refuses an archived
 * project ({@code 409 SF-DOM-0141}) through revision allocation.
 *
 * <p>Refusals, each for the whole call (nothing is written):
 * <ul>
 *   <li>{@code 422 SF-DOM-0150} — an item to release has {@code ERROR} completeness findings ({@code assets[]});
 *   <li>{@code 422 SF-DOM-0151} — an unknown asset or locale, or a type that has no release state;
 *   <li>{@code 422 SF-DOM-0152} — discarding an item with nothing released to go back to;
 *   <li>{@code 422 SF-DOM-0153} — an empty selection;
 *   <li>{@code 422 SF-DOM-0154} — a pinned version that isn't a version of its asset;
 *   <li>{@code 422 SF-DOM-0156} — an item to release has rule warnings and the call didn't accept them (M33.6).
 * </ul>
 */
public interface ReleaseService {

    /** The dry run: resolved items, proposed dependencies, completeness findings. Writes nothing. */
    ReleasePlan plan(long projectId, List<ReleaseItem> items);

    /**
     * Points each item's pointer at its draft (or pinned version). An item already published is skipped; releasing a
     * {@link ReleaseStatus#DELETION_PENDING deleted} item takes it offline.
     */
    default ReleaseOutcome release(List<ReleaseItem> items, RevisionContext ctx) {
        return release(items, false, ctx);
    }

    /**
     * As {@link #release(List, RevisionContext)}; {@code acceptWarnings} releases despite rule warnings, which the
     * outcome then lists. {@code release} fills that change a value store a new draft version in the release's own
     * revision and release that version (M33.6); a pinned version is released as it is.
     */
    ReleaseOutcome release(List<ReleaseItem> items, boolean acceptWarnings, RevisionContext ctx);

    /** Closes each item's pointer; the drafts stay. Items not released are skipped. */
    ReleaseOutcome unpublish(List<ReleaseItem> items, RevisionContext ctx);

    /** Writes each item's released version back as a new draft version (epic decision 11). Published items are skipped. */
    ReleaseOutcome discard(List<ReleaseItem> items, RevisionContext ctx);
}
