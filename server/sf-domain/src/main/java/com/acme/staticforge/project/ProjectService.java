package com.acme.staticforge.project;

import com.acme.staticforge.revision.RevisionContext;
import java.util.List;
import java.util.Optional;

/**
 * Project domain service (spec §8.1, §8.3). Owns project lifecycle and membership. Every
 * mutating method allocates a {@link com.acme.staticforge.revision.Revision} so no write
 * path bypasses revisioning (spec §21.2).
 */
public interface ProjectService {

    /**
     * Creates a project, initializes its revision counter at 1, allocates revision 1
     * ({@code CREATE}), and grants the acting user {@code PROJECT_ADMIN}. Returns the saved
     * project.
     */
    Project create(CreateProjectRequest cmd, Long actingUserId);

    Optional<Project> findByKey(String key);

    /** Returns the project or throws a 404 problem when absent. */
    Project requireByKey(String key);

    /**
     * {@link #requireByKey} for a write that allocates no revision (starting a generation run, creating a share
     * link, …): {@code 409 SF-DOM-0141} when the project is archived (M26, {@link ProjectWriteGuard}).
     */
    Project requireWritable(String key);

    /** All projects ordered by key (used by INSTANCE_ADMIN listing). */
    List<Project> listAll();

    /** {@code allowedMimeTypes} is always fully replaced; an empty/null list clears the override back to the instance-wide default. */
    Project update(String key, String name, String description, List<String> allowedMimeTypes, RevisionContext ctx);

    /**
     * Archives the project (M26, epic decision 12): read-only for everyone ({@code 409 SF-DOM-0141} on every write,
     * see {@link ProjectWriteGuard}) and hidden from every member but instance admins. Records an {@code UPDATE}
     * revision, audits {@code PROJECT_ARCHIVED} and bumps every member's token epoch, so each member's next request
     * already resolves the project as inaccessible. A generation run already queued or running is allowed to finish;
     * only new runs and promotes are refused. Archiving an archived project changes nothing.
     */
    void archive(String key, RevisionContext ctx);

    /** Reverses {@link #archive}: records a revision, audits {@code PROJECT_UNARCHIVED}, bumps members' epochs. */
    void unarchive(String key, RevisionContext ctx);

    /**
     * Replaces the project's content locale configuration (M24) and allocates one
     * {@code UPDATE} revision, like every other {@link #update} path. Project settings are
     * not versioned rows, so the configuration is overwritten in place and the revision
     * exists for attribution only.
     */
    LocaleUpdateResult updateLocales(String key, LocaleConfig config, boolean confirmDiscard, RevisionContext ctx);

    /** The project's locale configuration, {@link LocaleConfig#EMPTY} when none is set. */
    LocaleConfig locales(String key);

    /** The locale configuration of a project by numeric id (used by rendering and generation). */
    LocaleConfig localesById(Long projectId);

    /**
     * Outcome of {@link #updateLocales}: the normalized configuration plus what the caller
     * needs to warn about.
     *
     * @param urlsWillChange {@code true} when the edit changes generated output paths —
     *     the project became (or stopped being) localized, or the "default locale without
     *     prefix" setting flipped
     * @param removedLocales locales that were declared before and are not any more; their
     *     stored values are kept, not deleted
     * @param retainedValueCount how many stored values exist for {@code removedLocales}
     * @param confirmationRequired {@code true} when applying the change would drop translations
     *     (a project giving up its locales): nothing was written, and the caller must re-send with
     *     {@code confirmDiscard}
     * @param discardedLocaleValues how many translations the confirmed change drops
     * @param affectedAssets the assets whose content the change rewrites
     */
    record LocaleUpdateResult(
            LocaleConfig config,
            boolean urlsWillChange,
            java.util.List<String> removedLocales,
            int retainedValueCount,
            boolean confirmationRequired,
            int discardedLocaleValues,
            java.util.List<java.util.UUID> affectedAssets) {}

    /** The project's publish policy (M28), read from the row on every call: a change applies on the next check. */
    com.acme.staticforge.project.publish.PublishPolicy publishPolicy(String key);

    /**
     * Replaces the publish policy (M28.1.1, epic decision 10) and returns it. Throws
     * {@link com.acme.staticforge.project.publish.PublishPolicy.InvalidPolicyException} when it breaks an implication
     * and {@code 409 SF-DOM-0141} on an archived project. An identical policy changes nothing: no revision, no audit.
     * Otherwise one {@code UPDATE} revision (summary entry {@code PROJECT}, field {@code publishPolicy}) and the audit
     * action {@code PUBLISH_POLICY_SET} with {@code {before, after}}. Nobody's token changes: the policy is read per
     * check, never carried in a claim.
     */
    com.acme.staticforge.project.publish.PublishPolicy updatePublishPolicy(
            String key, com.acme.staticforge.project.publish.PublishPolicy policy, RevisionContext ctx);

    List<ProjectMember> members(String key);

    /** Upserts a membership and records an {@code UPDATE} revision + summary entry. */
    void setMemberRole(String key, Long userId, ProjectRole role, RevisionContext ctx);

    /** Removes a membership and records an {@code UPDATE} revision + summary entry. */
    void removeMember(String key, Long userId, RevisionContext ctx);

    /**
     * {@link #removeMember} for the anonymizing delete of an account (M26): also removes the membership of an
     * archived project, which {@link #removeMember} refuses like every other write to it.
     */
    void removeMemberOfDeletedAccount(String key, Long userId, RevisionContext ctx);

    List<ProjectMember> membershipsOf(Long userId);
}
