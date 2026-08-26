package com.acme.staticforge.urlregistry;

import com.acme.staticforge.revision.RevisionContext;
import java.util.UUID;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;

/**
 * "Assign once, cache forever until reset" contract for a {@code PageReference}'s URL in one
 * channel and one {@link UrlArea} (`M8.2.2`). {@link #resolve} is a read-through cache in front
 * of the resolution algorithm ({@code NavigationService}, `M8.1.3`) plus URL computation
 * ({@code LiveOutputPathResolver}, this package): an existing {@link UrlRegistryEntry} is
 * returned verbatim — never recomputed, never drift-checked against what
 * {@code LiveOutputPathResolver} would compute today — and only an absent entry triggers
 * computation and persistence.
 *
 * <p>{@code RevisionContext} is accepted by every method for audit-log purposes only, per this
 * feature's own spec text — see {@code UrlRegistryServiceImpl}'s class javadoc for why no actual
 * revision/audit-log call is made from these methods.
 */
public interface UrlRegistryService {

    /**
     * Returns the cached URL for the tuple, computing and persisting it on first access. Never
     * recomputes an existing entry, even if the page's live content has since changed —
     * call {@link #reset} to force recomputation.
     *
     * @throws com.acme.staticforge.common.SfException (not-found) when {@code pageReferenceUuid}
     *     doesn't resolve to a page (a stale/dangling reference, or an unknown uuid)
     */
    String resolve(UUID pageReferenceUuid, String channelKey, UrlArea area, RevisionContext ctx);

    /** Upserts the tuple with a manually-chosen URL, marking the entry {@code overridden}. */
    UrlRegistryEntry override(UUID pageReferenceUuid, String channelKey, UrlArea area, String url, RevisionContext ctx);

    /**
     * Deletes every entry matching {@code scope} (see {@link ResetScope}). Does not eagerly
     * recompute — the next {@link #resolve} call for an affected tuple repopulates it lazily,
     * with {@code overridden} cleared back to {@code false}.
     */
    void reset(long projectId, ResetScope scope, RevisionContext ctx);

    /**
     * Paginated, filterable listing for the settings UI ({@code M8.2.4}). {@code channelKey}/
     * {@code area} are optional (null = unfiltered); a thin passthrough to {@link
     * UrlRegistryRepository#search}, matching how {@code AssetService.search} wraps its own
     * repository's paginated query.
     */
    Page<UrlRegistryEntry> search(long projectId, String channelKey, UrlArea area, Pageable pageable);

    /**
     * Looks up a single entry, scoped to {@code projectId} so a project-scoped REST caller
     * (`M8.2.4`) can never reach another project's row by guessing an id.
     *
     * @throws com.acme.staticforge.common.SfException (not-found) when no such entry exists in
     *     this project
     */
    UrlRegistryEntry require(long projectId, long id);
}
