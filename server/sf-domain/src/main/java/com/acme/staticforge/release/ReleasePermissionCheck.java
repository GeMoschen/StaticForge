package com.acme.staticforge.release;

import com.acme.staticforge.revision.RevisionContext;

/**
 * Who may change release state (M27.1.2, epic decision 15): one method per operation, so M28 can open release,
 * unpublish and discard to editors by project policy by replacing this one bean. {@link ReleaseService} calls it
 * with the acting user of every mutation — the API user, or the owner of a scheduled action (M27.4) — so the rule
 * holds whichever path triggers a release. A context without a user is the system (a migration) and always passes.
 */
public interface ReleasePermissionCheck {

    /** Throws {@code 403} unless the actor may release. */
    void requireRelease(RevisionContext ctx);

    /** Throws {@code 403} unless the actor may unpublish. */
    void requireUnpublish(RevisionContext ctx);

    /** Throws {@code 403} unless the actor may discard changes. */
    void requireDiscard(RevisionContext ctx);
}
