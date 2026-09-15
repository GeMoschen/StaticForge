package com.acme.staticforge.urlregistry;

import com.acme.staticforge.asset.navigation.LiveNavigationLookup;
import com.acme.staticforge.asset.navigation.NavigationService;
import com.acme.staticforge.channel.OutputPathExpander;
import com.acme.staticforge.common.ProblemFactory;
import com.acme.staticforge.common.SfException;
import com.acme.staticforge.revision.Revision;
import com.acme.staticforge.revision.RevisionContext;
import com.acme.staticforge.revision.RevisionService;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * {@link UrlRegistryService} implementation (`M8.2.2`).
 *
 * <p><b>URL computation outside a full generation run.</b> {@code OutputPathResolver} (the §18.3
 * placeholder-expansion resolver) lives in sf-generate and is built from a revision-pinned
 * {@code Snapshot} — unusable here both because this service lives in sf-domain (sf-generate
 * depends on sf-domain, never the reverse) and because a bare {@code resolve} call (e.g. a first
 * preview visit, or a manual REST call from `M8.2.4`, before any generation has ever run) has no
 * snapshot to pin to. The §18.3 algorithm itself was extracted out of {@code OutputPathResolver}
 * into {@link OutputPathExpander} (sf-domain, {@code com.acme.staticforge.channel}), which takes
 * a module-agnostic {@code PageContext} instead of a {@code SnapshotAsset}. {@link
 * LiveOutputPathResolver} (this package) adapts that shared algorithm onto the live {@code
 * Asset}/{@code AssetVersion} repositories, mirroring exactly how {@code LiveNavigationLookup}
 * adapts {@code NavigationLookup} for the same live-vs-snapshot split introduced by `M8.1.3`.
 * {@code OutputPathResolver} itself was refactored to delegate to {@link OutputPathExpander} too,
 * so generation's {@code GENERATED} URLs and this service's on-demand computation (used for both
 * {@code PREVIEW} and, before generation wiring lands in `M8.2.3`, {@code GENERATED}) can never
 * drift apart.
 *
 * <p><b>Channel output settings.</b> {@code indexUid}/{@code trailingSlash}/{@code urlStrategy}
 * are not yet wired from {@code OutputChannel.settings} anywhere in this codebase —
 * {@code GenerationService} itself still hardcodes {@code ("index", false, "DEFAULT")}
 * (see {@code GenerationService.run}). This service intentionally mirrors that exact same
 * hardcoded tuple ({@link #DEFAULT_INDEX_UID}/{@link #DEFAULT_TRAILING_SLASH}/{@link
 * #DEFAULT_URL_STRATEGY}) rather than inventing a different, disconnected convention — wiring
 * real per-channel settings through both call sites is a pre-existing gap left for whichever
 * future task closes it, not something this task should paper over with a second hardcoded
 * default that could drift from generation's.
 *
 * <p><b>Concurrent first-{@code resolve} race safety.</b> Per this feature's Notes/hazards, no
 * distributed lock is used. The unique constraint from `M8.2.1`
 * ({@code uq_url_registry_tuple}) is the source of truth: if two callers race to compute the
 * same absent tuple, both run {@link UrlRegistryRepository#insertIfAbsent} ({@code INSERT ... ON
 * CONFLICT DO NOTHING}) and then re-read, so the loser's insert is a silent no-op and it reads the
 * winner's row. (Catching a unique violation from {@code save} instead cannot work: the failed
 * insert leaves the entity in the session and marks the transaction rollback-only.)
 *
 * <p><b>{@code RevisionContext} / audit trail.</b> Confirmed against {@code RevisionService}
 * (the M1 revision service): {@code RevisionService.allocate} always creates a real {@code
 * Revision} row tied to an asset-change summary (spec §21.2/§21.3) — it models "a project
 * revision", not a generic non-asset audit log, and {@code UrlRegistryEntry} deliberately does
 * not participate in the revision spine (`M8.2.1`'s Notes: "this entity does not participate in
 * the {@code @RevisionAware}/repository-write ArchUnit convention"). There is no separate
 * lighter-weight audit-log mechanism elsewhere in this codebase for a non-revisioned write.
 * Calling {@code RevisionService.allocate} from here would misrepresent a cache
 * assignment/reset as a project revision, so this service does not call it. {@code
 * RevisionContext.userId()}/{@code comment()} are therefore unused by every method here — the
 * parameter exists solely so callers (`M8.2.3`, `M8.2.4`) have one consistent
 * revision-context-carrying signature across all of this feature's write paths, matching every
 * other mutating service in this codebase. {@code RevisionContext.projectId()} *is* used, as the
 * tuple's project scope. {@link RevisionService#findRecent} (read-only, allocates nothing) is
 * used only to stamp {@code assignedRevision} with the project's current latest revision id for
 * audit/debugging (per `M8.2.1`'s entity javadoc — "never used to invalidate"), defaulting to 0
 * for a project with no revisions yet.
 */
@Service
public class UrlRegistryServiceImpl implements UrlRegistryService {

    static final String DEFAULT_INDEX_UID = "index";
    static final boolean DEFAULT_TRAILING_SLASH = false;
    static final String DEFAULT_URL_STRATEGY = "DEFAULT";

    private final UrlRegistryRepository repository;
    private final NavigationService navigationService;
    private final LiveNavigationLookup navigationLookup;
    private final LiveOutputPathResolver outputPathResolver;
    private final RevisionService revisionService;

    public UrlRegistryServiceImpl(
            UrlRegistryRepository repository,
            NavigationService navigationService,
            LiveNavigationLookup navigationLookup,
            LiveOutputPathResolver outputPathResolver,
            RevisionService revisionService) {
        this.repository = repository;
        this.navigationService = navigationService;
        this.navigationLookup = navigationLookup;
        this.outputPathResolver = outputPathResolver;
        this.revisionService = revisionService;
    }

    @Override
    @Transactional
    public String resolve(UUID pageReferenceUuid, String channelKey, UrlArea area, RevisionContext ctx) {
        return find(ctx.projectId(), channelKey, pageReferenceUuid, area)
                .map(UrlRegistryEntry::getUrl)
                .orElseGet(() -> computeAndPersist(pageReferenceUuid, channelKey, area, ctx).getUrl());
    }

    @Override
    @Transactional
    public UrlRegistryEntry override(UUID pageReferenceUuid, String channelKey, UrlArea area, String url, RevisionContext ctx) {
        if (url == null || url.isBlank()) {
            throw new SfException(ProblemFactory.badRequest("url must not be blank."));
        }
        UrlRegistryEntry entry = find(ctx.projectId(), channelKey, pageReferenceUuid, area)
                .orElseGet(() -> new UrlRegistryEntry(
                        ctx.projectId(), channelKey, pageReferenceUuid, area, url, Instant.now(), currentRevision(ctx.projectId()), true));
        entry.setUrl(url);
        entry.setOverridden(true);
        entry.setAssignedAt(Instant.now());
        return repository.save(entry);
    }

    @Override
    @Transactional
    public void reset(long projectId, ResetScope scope, RevisionContext ctx) {
        switch (scope.kind()) {
            case ENTRY -> repository.deleteById(scope.entryId());
            case CHANNEL -> repository.deleteByProjectIdAndChannelKey(projectId, scope.channelKey());
            case AREA -> repository.deleteByProjectIdAndArea(projectId, scope.area());
            case PROJECT -> repository.deleteByProjectId(projectId);
        }
    }

    @Override
    public Page<UrlRegistryEntry> search(long projectId, String channelKey, UrlArea area, Pageable pageable) {
        return repository.search(projectId, channelKey, area, pageable);
    }

    @Override
    public UrlRegistryEntry require(long projectId, long id) {
        UrlRegistryEntry entry = repository
                .findById(id)
                .orElseThrow(() -> new SfException(ProblemFactory.notFound("URL registry entry not found.")));
        if (entry.getProjectId() != projectId) {
            throw new SfException(ProblemFactory.notFound("URL registry entry not found."));
        }
        return entry;
    }

    // ------------------------------------------------------------------

    private Optional<UrlRegistryEntry> find(long projectId, String channelKey, UUID pageReferenceUuid, UrlArea area) {
        return repository.findByProjectIdAndChannelKeyAndPageReferenceUuidAndArea(projectId, channelKey, pageReferenceUuid, area);
    }

    private UrlRegistryEntry computeAndPersist(UUID pageReferenceUuid, String channelKey, UrlArea area, RevisionContext ctx) {
        UUID resolvedPageUuid = navigationService.resolve(ctx.projectId(), pageReferenceUuid, navigationLookup);
        if (resolvedPageUuid == null) {
            throw new SfException(ProblemFactory.notFound("Page reference does not resolve to a navigable page."));
        }
        String url = outputPathResolver
                .resolveUrl(ctx.projectId(), resolvedPageUuid, channelKey, DEFAULT_INDEX_UID, DEFAULT_TRAILING_SLASH, DEFAULT_URL_STRATEGY)
                .orElseThrow(() -> new SfException(ProblemFactory.notFound("Resolved page not found.")));
        // Insert-if-absent, then read back: whether this call or a concurrent one inserted the row,
        // the read returns the single winner. A lost race is a no-op insert, never an exception.
        repository.insertIfAbsent(
                ctx.projectId(), channelKey, pageReferenceUuid, area.name(), url, Instant.now(), currentRevision(ctx.projectId()));
        return find(ctx.projectId(), channelKey, pageReferenceUuid, area)
                .orElseThrow(() -> new IllegalStateException(
                        "URL registry entry missing right after insert-if-absent for " + pageReferenceUuid));
    }

    private long currentRevision(long projectId) {
        List<Revision> recent = revisionService.findRecent(projectId, PageRequest.of(0, 1));
        return recent.isEmpty() ? 0L : recent.get(0).getRevisionId();
    }
}
