package com.acme.staticforge.channel;

import com.acme.staticforge.revision.RevisionContext;
import com.acme.staticforge.template.render.Escaping;
import java.util.List;

/**
 * Output-channel domain operations (spec §15). Channels are project-scoped configuration;
 * every mutation allocates a revision via {@link com.acme.staticforge.revision.RevisionService}
 * so the change is on the project's record. {@code html} is seeded on project create and cannot
 * be deleted (only disabled); deletion is blocked while any template still carries a channel
 * template for the key.
 */
public interface ChannelService {

    List<OutputChannel> list(long projectId);

    /**
     * Creates a channel. Validates the key ({@code [a-z][a-z0-9_]{1,39}}), rejects a duplicate
     * key (409), allocates a revision and appends a summary. When {@code copyFrom} is non-blank,
     * each template's {@code copyFrom} channel OCTL is cloned into the new key in one revision.
     */
    OutputChannel create(CreateChannelRequest req, RevisionContext ctx);

    OutputChannel update(String key, UpdateChannelRequest req, RevisionContext ctx);

    OutputChannel setEnabled(String key, boolean enabled, RevisionContext ctx);

    /** The templates still carrying a channel template for {@code key} (UI preview). */
    DeletePreview previewDelete(long projectId, String key);

    /**
     * Deletes the channel. {@code html} is non-deletable (422 {@code SF-CH-0101}); deletion is
     * blocked (409 {@code SF-CH-0201}, affected templates in the {@code blockedBy} extension)
     * when templates still carry a channel template for the key.
     */
    void delete(String key, RevisionContext ctx);

    /** Maps the channel's {@code default_escaping} to an {@link Escaping} (default HTML). */
    Escaping defaultEscaping(long projectId, String channelKey);

    /**
     * Seeds {@code newChannelKey} channel templates from {@code sourceChannelKey} for every page
     * and section template in the project whose payload carries the source key, in one revision.
     */
    void seedFrom(String newChannelKey, String sourceChannelKey, RevisionContext ctx);

    /**
     * Creates the default {@code html} channel when absent. Takes a {@link RevisionContext} like
     * every other mutating channel method so it can be folded into a caller's open batch, but
     * still allocates NO revision of its own today: channel bootstrap isn't revision-tracked, and
     * {@link com.acme.staticforge.project.ProjectService#create} already covers project creation
     * with its own (batch) revision.
     */
    void ensureDefaultChannels(RevisionContext ctx);
}
