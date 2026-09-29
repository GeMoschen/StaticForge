package com.acme.staticforge.urlregistry;

import com.acme.staticforge.asset.Asset;
import com.acme.staticforge.asset.AssetRepository;
import com.acme.staticforge.asset.AssetType;
import com.acme.staticforge.asset.AssetVersion;
import com.acme.staticforge.asset.AssetVersionRepository;
import com.acme.staticforge.asset.folder.FolderScope;
import com.acme.staticforge.asset.navigation.LiveNavigationLookup;
import com.acme.staticforge.asset.navigation.NavigationService;
import com.acme.staticforge.channel.ChannelOutputSettings;
import com.acme.staticforge.channel.ChannelService;
import com.acme.staticforge.channel.OutputPathExpander;
import com.acme.staticforge.common.ProblemFactory;
import com.acme.staticforge.common.SfException;
import com.acme.staticforge.project.LocaleConfig;
import com.acme.staticforge.project.ProjectLocales;
import com.acme.staticforge.project.ProjectWriteGuard;
import com.acme.staticforge.revision.Revision;
import com.acme.staticforge.revision.RevisionContext;
import com.acme.staticforge.revision.RevisionService;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Collection;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.function.Supplier;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * {@link UrlRegistryService} implementation (`M8.2.2`, every target since M32.2).
 *
 * <p><b>URL computation outside a build.</b> sf-domain cannot use sf-generate's snapshot-based
 * {@code OutputPathResolver}, so a preview (or an API call) computes a page's URL from the live drafts with
 * {@link LiveOutputPathResolver}, which shares the §18.3 algorithm ({@link OutputPathExpander}) with generation.
 *
 * <p><b>Channel output settings.</b> URLs are computed with the channel's own {@link ChannelOutputSettings}. Because
 * rows are assign-once, {@code ChannelServiceImpl.update} drops a channel's computed rows when its output settings
 * change, so they are recomputed with the new settings.
 *
 * <p><b>Races.</b> No lock: the unique constraints are the source of truth. A first assignment runs
 * {@link UrlRegistryRepository#insertIfAbsent} ({@code INSERT ... ON CONFLICT DO NOTHING}) and reads back, so a lost
 * race is a silent no-op and the winner's row is read; a URL another target took inserts nothing and reads back
 * nothing.
 *
 * <p><b>Revisions.</b> A registry row is not a revisioned asset: assignments, overrides and resets allocate no project
 * revision. {@code assignedRevision} only stamps the project's latest revision for audit/debugging. Overrides, resets
 * and imports record a {@link UrlRegistryChange} instead, which an incremental build reads (M32.5).
 */
@Service
public class UrlRegistryServiceImpl implements UrlRegistryService {

    private static final Logger log = LoggerFactory.getLogger(UrlRegistryServiceImpl.class);

    private final UrlRegistryRepository repository;
    private final UrlRegistryChangeRepository changes;
    private final NavigationService navigationService;
    private final LiveNavigationLookup navigationLookup;
    private final LiveOutputPathResolver outputPathResolver;
    private final RevisionService revisionService;
    private final ChannelService channelService;
    private final ProjectLocales projectLocales;
    private final ProjectWriteGuard writeGuard;
    private final AssetRepository assetRepository;
    private final AssetVersionRepository assetVersionRepository;
    private final org.springframework.jdbc.core.JdbcTemplate jdbc;

    /** Claims are inserted in batches of this size (M32.3): a first build registers every output at once. */
    private static final int INSERT_BATCH = 500;

    private static final String INSERT_IF_ABSENT = """
            INSERT INTO url_registry_entry
                (project_id, channel_key, area, locale_key, target_type, target_uuid, variant_key, page_number, url,
                 assigned_at, assigned_revision, overridden)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, FALSE)
            ON CONFLICT DO NOTHING
            """;

    public UrlRegistryServiceImpl(
            UrlRegistryRepository repository,
            UrlRegistryChangeRepository changes,
            NavigationService navigationService,
            LiveNavigationLookup navigationLookup,
            LiveOutputPathResolver outputPathResolver,
            RevisionService revisionService,
            ChannelService channelService,
            ProjectLocales projectLocales,
            ProjectWriteGuard writeGuard,
            AssetRepository assetRepository,
            AssetVersionRepository assetVersionRepository,
            org.springframework.jdbc.core.JdbcTemplate jdbc) {
        this.jdbc = jdbc;
        this.repository = repository;
        this.changes = changes;
        this.writeGuard = writeGuard;
        this.navigationService = navigationService;
        this.navigationLookup = navigationLookup;
        this.outputPathResolver = outputPathResolver;
        this.revisionService = revisionService;
        this.channelService = channelService;
        this.projectLocales = projectLocales;
        this.assetRepository = assetRepository;
        this.assetVersionRepository = assetVersionRepository;
    }

    // ------------------------------------------------------------------
    // Resolution
    // ------------------------------------------------------------------

    @Override
    @Transactional
    public String resolve(
            UrlTarget target,
            String channelKey,
            UrlArea area,
            String localeKey,
            Supplier<String> computed,
            RevisionContext ctx) {
        long projectId = ctx.projectId();
        String channel = target.channelKey(channelKey);
        String locale = localeKey == null ? "" : localeKey;
        Optional<UrlRegistryEntry> existing = find(projectId, channel, area, locale, target);
        if (existing.isPresent()) {
            return existing.get().getUrl();
        }
        String url = computed.get();
        if (url == null) {
            return null;
        }
        repository.insertIfAbsent(
                projectId, channel, area.name(), locale, target.type().name(), target.uuid(), target.variant(),
                target.pageNumber(), url, Instant.now(), currentRevision(projectId), false);
        Optional<UrlRegistryEntry> stored = find(projectId, channel, area, locale, target);
        if (stored.isPresent()) {
            return stored.get().getUrl();
        }
        log.info("URL '{}' of {} is held by another target in channel '{}', {} {}; not registered",
                url, target.describe(), channel, area, locale);
        return url;
    }

    @Override
    @Transactional
    public String resolvePage(
            UUID pageUuid, int pageNumber, String channelKey, UrlArea area, String locale, RevisionContext ctx) {
        long projectId = ctx.projectId();
        ChannelOutputSettings settings = channelService.outputSettings(projectId, channelKey);
        String localeKey = localeKey(projectId, locale);
        OutputPathExpander.LocaleContext localeContext = localeContext(projectId, localeKey);
        if (pageNumber <= 1) {
            return resolve(UrlTarget.page(pageUuid), channelKey, area, localeKey,
                    () -> outputPathResolver.resolvePath(projectId, pageUuid, channelKey, settings, localeContext)
                            .map(path -> OutputPathExpander.urlForOutput(path, settings))
                            .orElse(null),
                    ctx);
        }
        String first = resolvePage(pageUuid, 1, channelKey, area, locale, ctx);
        if (first == null) {
            return null;
        }
        String firstPath = OutputPathExpander.pathForUrl(first, settings);
        return resolve(UrlTarget.page(pageUuid, pageNumber), channelKey, area, localeKey,
                () -> outputPathResolver
                        .resolvePaginationPath(projectId, pageUuid, channelKey, settings, localeContext, firstPath, pageNumber)
                        .map(path -> OutputPathExpander.urlForOutput(path, settings))
                        .orElse(null),
                ctx);
    }

    @Override
    @Transactional
    public String resolvePageReference(
            UUID pageReferenceUuid, String channelKey, UrlArea area, String locale, RevisionContext ctx) {
        ChannelOutputSettings settings = channelService.outputSettings(ctx.projectId(), channelKey);
        // A folder target resolves to its index page in this channel: its indexUid page.
        UUID page = navigationService.resolve(
                ctx.projectId(), pageReferenceUuid, navigationLookup.withIndexUid(settings.indexUid()));
        if (page == null) {
            throw new SfException(ProblemFactory.notFound("Page reference does not resolve to a navigable page."));
        }
        String url = resolvePage(page, 1, channelKey, area, locale, ctx);
        if (url == null) {
            throw new SfException(ProblemFactory.notFound("Resolved page not found."));
        }
        return url;
    }

    // ------------------------------------------------------------------
    // Overrides and resets
    // ------------------------------------------------------------------

    @Override
    @Transactional
    public UrlRegistryEntry override(
            UrlTarget target, String channelKey, UrlArea area, String localeKey, String url, RevisionContext ctx) {
        long projectId = ctx.projectId();
        // An override or reset allocates no revision (see the class comment), so it checks the archived state itself.
        writeGuard.requireWritable(projectId);
        if (area == null) {
            throw UrlRegistryProblems.invalid("area is required.", "area");
        }
        String channel = target.channelKey(channelKey);
        if (target.type() != UrlTargetType.MEDIA && (channel == null || channel.isBlank())) {
            throw UrlRegistryProblems.invalid("channelKey is required for a " + target.type().name().toLowerCase(Locale.ROOT)
                    + " URL.", "channelKey");
        }
        String locale = validLocaleKey(projectId, localeKey);
        ChannelOutputSettings settings = target.type() == UrlTargetType.MEDIA
                ? null
                : channelService.outputSettings(projectId, channel);
        requireOverridableTarget(projectId, target, settings);
        String normalized = normalizeUrl(url);
        validateUrl(target, normalized, settings);
        repository.findByProjectIdAndChannelKeyAndAreaAndLocaleKeyAndUrl(projectId, channel, area, locale, normalized)
                .filter(holder -> !holder.target().equals(target))
                .ifPresent(holder -> {
                    String uid = assetRepository.findByProjectIdAndUuid(projectId, holder.getTargetUuid())
                            .map(Asset::getUid)
                            .orElse(null);
                    throw UrlRegistryProblems.urlTaken(normalized, holder.target(), uid);
                });
        UrlRegistryEntry entry = find(projectId, channel, area, locale, target)
                .orElseGet(() -> new UrlRegistryEntry(
                        projectId, channel, target, area, locale, normalized, Instant.now(), currentRevision(projectId), true));
        entry.setUrl(normalized);
        entry.setOverridden(true);
        entry.setAssignedAt(Instant.now());
        UrlRegistryEntry saved = repository.save(entry);
        recordChange(projectId, area, target.type(), target.uuid());
        return saved;
    }

    @Override
    @Transactional
    public void reset(long projectId, ResetScope scope, RevisionContext ctx) {
        writeGuard.requireWritable(projectId);
        switch (scope.kind()) {
            case ENTRY -> repository.findById(scope.entryId())
                    .filter(entry -> entry.getProjectId() == projectId)
                    .ifPresent(entry -> {
                        repository.delete(entry);
                        recordChange(projectId, entry.getArea(), entry.getTargetType(), entry.getTargetUuid());
                    });
            case ASSET -> {
                List<UrlRegistryEntry> rows = repository.findByProjectIdAndTargetUuid(projectId, scope.targetUuid());
                if (scope.area() == null) {
                    repository.deleteByProjectIdAndTargetUuid(projectId, scope.targetUuid());
                } else {
                    repository.deleteByProjectIdAndTargetUuidAndArea(projectId, scope.targetUuid(), scope.area());
                }
                UrlTargetType type = rows.isEmpty() ? null : rows.get(0).getTargetType();
                recordChange(projectId, scope.area(), type, scope.targetUuid());
            }
            case CHANNEL -> {
                repository.deleteByProjectIdAndChannelKey(projectId, scope.channelKey());
                recordChange(projectId, null, null, null);
            }
            case AREA -> {
                repository.deleteByProjectIdAndArea(projectId, scope.area());
                recordChange(projectId, scope.area(), null, null);
            }
            case PROJECT -> {
                repository.deleteByProjectId(projectId);
                recordChange(projectId, null, null, null);
            }
        }
    }

    // ------------------------------------------------------------------
    // Builds
    // ------------------------------------------------------------------

    @Override
    @Transactional(readOnly = true)
    public UrlRegistryView view(long projectId, UrlArea area) {
        return UrlRegistryView.of(repository.findByProjectIdAndArea(projectId, area));
    }

    @Override
    @Transactional
    public List<UrlRegistryView.Claim> register(
            long projectId, UrlArea area, Collection<UrlRegistryView.Claim> claims) {
        if (claims.isEmpty()) {
            return List.of();
        }
        long revision = currentRevision(projectId);
        java.sql.Timestamp now = java.sql.Timestamp.from(Instant.now());
        List<UrlRegistryView.Claim> all = List.copyOf(claims);
        List<UrlRegistryView.Claim> rejected = new ArrayList<>();
        List<UrlRegistryView.Claim> unknown = new ArrayList<>();
        // JDBC batches rather than one statement each: the ON CONFLICT insert reports per row whether it inserted.
        for (int from = 0; from < all.size(); from += INSERT_BATCH) {
            List<UrlRegistryView.Claim> chunk = all.subList(from, Math.min(from + INSERT_BATCH, all.size()));
            int[] counts = jdbc.batchUpdate(INSERT_IF_ABSENT, new org.springframework.jdbc.core.BatchPreparedStatementSetter() {
                @Override
                public void setValues(java.sql.PreparedStatement ps, int i) throws java.sql.SQLException {
                    UrlRegistryView.Claim claim = chunk.get(i);
                    UrlTarget target = claim.key().target();
                    ps.setLong(1, projectId);
                    ps.setString(2, claim.key().channelKey());
                    ps.setString(3, area.name());
                    ps.setString(4, claim.key().localeKey());
                    ps.setString(5, target.type().name());
                    ps.setObject(6, target.uuid());
                    ps.setString(7, target.variant());
                    ps.setInt(8, target.pageNumber());
                    ps.setString(9, claim.url());
                    ps.setTimestamp(10, now);
                    ps.setLong(11, revision);
                }

                @Override
                public int getBatchSize() {
                    return chunk.size();
                }
            });
            for (int i = 0; i < counts.length; i++) {
                if (counts[i] == 0) {
                    rejected.add(chunk.get(i));
                } else if (counts[i] < 0) {
                    unknown.add(chunk.get(i));
                }
            }
        }
        // A driver that doesn't report per-row counts: a claim is stored when its row now holds its URL.
        for (UrlRegistryView.Claim claim : unknown) {
            UrlTarget target = claim.key().target();
            boolean stored = find(projectId, claim.key().channelKey(), area, claim.key().localeKey(), target)
                    .map(row -> row.getUrl().equals(claim.url()))
                    .orElse(false);
            if (!stored) {
                rejected.add(claim);
            }
        }
        return rejected;
    }

    @Override
    @Transactional
    public int deleteComputed(long projectId, UrlArea area, Collection<UrlRegistryView.Key> keys) {
        if (keys.isEmpty()) {
            return 0;
        }
        Set<UrlRegistryView.Key> wanted = new HashSet<>(keys);
        List<Long> ids = new ArrayList<>();
        for (UrlRegistryEntry row : repository.findByProjectIdAndArea(projectId, area)) {
            if (!row.isOverridden()
                    && wanted.contains(new UrlRegistryView.Key(row.target(), row.getChannelKey(), row.getLocaleKey()))) {
                ids.add(row.getId());
            }
        }
        if (!ids.isEmpty()) {
            repository.deleteAllByIdInBatch(ids);
        }
        return ids.size();
    }

    @Override
    @Transactional
    public void deleteComputed(long projectId, UUID targetUuid, UrlArea area) {
        if (area == null) {
            repository.deleteByProjectIdAndTargetUuidAndAreaAndOverriddenFalse(projectId, targetUuid, UrlArea.PREVIEW);
            repository.deleteByProjectIdAndTargetUuidAndAreaAndOverriddenFalse(projectId, targetUuid, UrlArea.GENERATED);
        } else {
            repository.deleteByProjectIdAndTargetUuidAndAreaAndOverriddenFalse(projectId, targetUuid, area);
        }
    }

    @Override
    @Transactional(readOnly = true)
    public List<UrlRegistryChange> changesSince(long projectId, UrlArea area, Instant since) {
        return changes.findSince(projectId, area, since);
    }

    // ------------------------------------------------------------------
    // Listing
    // ------------------------------------------------------------------

    @Override
    @Transactional(readOnly = true)
    public Page<UrlRegistryEntry> search(long projectId, Filter filter, Pageable pageable) {
        Filter f = filter == null ? Filter.NONE : filter;
        String localeKey = f.locale() == null ? null : localeKeyFilter(projectId, f.locale());
        String q = f.q() == null || f.q().isBlank() ? null : f.q().trim().toLowerCase(Locale.ROOT);
        String urlLike = q == null ? null : "%" + escapeLike(q) + "%";
        Set<UUID> named = q == null ? Set.of() : targetsNamed(projectId, q);
        boolean anyTarget = named.isEmpty();
        // An empty IN list is not portable: the flag disables the clause, and a random uuid keeps the list non-empty.
        Collection<UUID> uuids = anyTarget ? List.of(UUID.randomUUID()) : named;
        Pageable sorted = pageable.getSort().isSorted() || pageable.isUnpaged()
                ? pageable
                : PageRequest.of(pageable.getPageNumber(), pageable.getPageSize(),
                        org.springframework.data.domain.Sort.by("url").ascending().and(
                                org.springframework.data.domain.Sort.by("id").ascending()));
        return repository.search(projectId, blankToNull(f.channelKey()), f.area(), f.targetType(), localeKey,
                f.targetUuid(), urlLike, anyTarget, uuids, sorted);
    }

    /** The targets whose display name or uid contains {@code q} (lowercase). */
    private Set<UUID> targetsNamed(long projectId, String q) {
        Set<UUID> uuids = new HashSet<>();
        for (AssetType type : List.of(AssetType.PAGE, AssetType.MEDIA, AssetType.FOLDER)) {
            for (AssetVersion version : assetVersionRepository.findCurrentByProjectAndType(projectId, type)) {
                Asset asset = version.getAsset();
                String name = version.getDisplayName() == null ? "" : version.getDisplayName().toLowerCase(Locale.ROOT);
                String uid = asset.getUid() == null ? "" : asset.getUid().toLowerCase(Locale.ROOT);
                if (name.contains(q) || uid.contains(q)) {
                    uuids.add(asset.getUuid());
                }
            }
        }
        return uuids;
    }

    private static String escapeLike(String value) {
        return value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_");
    }

    @Override
    @Transactional(readOnly = true)
    public UrlRegistryEntry require(long projectId, long id) {
        UrlRegistryEntry entry = repository
                .findById(id)
                .orElseThrow(() -> new SfException(ProblemFactory.notFound("URL registry entry not found.")));
        if (entry.getProjectId() != projectId) {
            throw new SfException(ProblemFactory.notFound("URL registry entry not found."));
        }
        return entry;
    }

    @Override
    @Transactional(readOnly = true)
    public List<UrlRegistryEntry> all(long projectId, UrlArea area) {
        return repository.findByProjectIdAndAreaOrderByIdAsc(projectId, area);
    }

    @Override
    @Transactional(readOnly = true)
    public Map<UUID, TargetInfo> describe(long projectId, Collection<UUID> uuids) {
        Map<UUID, TargetInfo> infos = new HashMap<>();
        if (uuids == null || uuids.isEmpty()) {
            return infos;
        }
        List<Asset> assets = assetRepository.findByProjectIdAndUuidIn(projectId, new HashSet<>(uuids));
        Map<Long, Asset> byId = new HashMap<>();
        assets.forEach(asset -> byId.put(asset.getId(), asset));
        for (AssetVersion version : assetVersionRepository.findOpenWithAssetByAssetIdIn(byId.keySet())) {
            Asset asset = byId.get(version.getAssetId());
            if (asset == null) {
                continue;
            }
            // A folder's version stores its own path; any other asset's the path of its folder.
            infos.put(asset.getUuid(), new TargetInfo(asset.getUuid(), asset.getAssetType().name(), asset.getUid(),
                    version.getDisplayName(), version.getFolderPath(), version.isDeleted()));
        }
        return infos;
    }

    @Override
    @Transactional(readOnly = true)
    public List<IndexPage> indexPages(long projectId, UUID folderUuid) {
        List<IndexPage> pages = new ArrayList<>();
        for (com.acme.staticforge.channel.OutputChannel channel : channelService.list(projectId)) {
            ChannelOutputSettings settings = channelService.outputSettings(projectId, channel.getKey());
            navigationService.indexPage(projectId, folderUuid, navigationLookup.withIndexUid(settings.indexUid()))
                    .ifPresent(page -> pages.add(new IndexPage(channel.getKey(), page)));
        }
        return pages;
    }

    // ------------------------------------------------------------------
    // Import
    // ------------------------------------------------------------------

    @Override
    @Transactional
    public List<ImportResult> importRows(long projectId, Collection<ImportedRow> rows, ImportMode mode, boolean dryRun) {
        ImportMode effective = mode == null ? ImportMode.ARCHIVE_WINS : mode;
        List<ImportResult> results = new ArrayList<>();
        Map<UrlTarget, UrlArea> changed = new HashMap<>();
        long revision = dryRun ? 0 : currentRevision(projectId);
        for (ImportedRow row : rows) {
            String channel = row.target().channelKey(row.channelKey());
            String locale = row.localeKey() == null ? "" : row.localeKey();
            Optional<UrlRegistryEntry> existing = find(projectId, channel, row.area(), locale, row.target());
            if (existing.isPresent() && existing.get().getUrl().equals(row.url())) {
                results.add(new ImportResult(row, ImportOutcome.UNCHANGED, null));
                continue;
            }
            if (existing.isPresent()) {
                if (effective == ImportMode.TARGET_WINS) {
                    results.add(new ImportResult(row, ImportOutcome.KEPT_TARGET, null));
                    continue;
                }
                if (effective == ImportMode.ARCHIVE_WINS && existing.get().isOverridden()) {
                    results.add(new ImportResult(row, ImportOutcome.KEPT_TARGET_OVERRIDE, null));
                    continue;
                }
            }
            Optional<UrlRegistryEntry> holder = repository
                    .findByProjectIdAndChannelKeyAndAreaAndLocaleKeyAndUrl(projectId, channel, row.area(), locale, row.url())
                    .filter(other -> !other.target().equals(row.target()));
            if (holder.isPresent()) {
                results.add(new ImportResult(row, ImportOutcome.URL_TAKEN, holder.get().target()));
                continue;
            }
            ImportOutcome outcome = existing.isPresent() ? ImportOutcome.REPLACED : ImportOutcome.INSERTED;
            if (!dryRun) {
                existing.ifPresent(entry -> {
                    repository.delete(entry);
                    repository.flush();
                });
                int inserted = repository.insertIfAbsent(projectId, channel, row.area().name(), locale,
                        row.target().type().name(), row.target().uuid(), row.target().variant(),
                        row.target().pageNumber(), row.url(), Instant.now(), revision, row.overridden());
                if (inserted == 0) {
                    results.add(new ImportResult(row, ImportOutcome.URL_TAKEN, null));
                    continue;
                }
                changed.put(row.target(), row.area());
            }
            results.add(new ImportResult(row, outcome, null));
        }
        changed.forEach((target, area) -> recordChange(projectId, area, target.type(), target.uuid()));
        return results;
    }

    // ------------------------------------------------------------------

    @Override
    public String localeKey(long projectId, String locale) {
        LocaleConfig config = projectLocales.forProject(projectId);
        if (!config.isLocalized()) {
            return "";
        }
        String declared = config.canonicalDeclared(locale);
        return declared != null ? declared : config.defaultLocale();
    }

    /** A language filter: {@code ""} stays (rows without a language), a tag is canonicalized when declared. */
    private String localeKeyFilter(long projectId, String locale) {
        if (locale.isEmpty()) {
            return "";
        }
        String declared = projectLocales.forProject(projectId).canonicalDeclared(locale);
        return declared != null ? declared : locale;
    }

    /** An override's language key: {@code ""} or a declared language of the project. */
    private String validLocaleKey(long projectId, String localeKey) {
        if (localeKey == null || localeKey.isEmpty()) {
            return "";
        }
        String declared = projectLocales.forProject(projectId).canonicalDeclared(localeKey);
        if (declared == null) {
            throw UrlRegistryProblems.invalid("'" + localeKey + "' is not a language of the project.", "locale");
        }
        return declared;
    }

    /**
     * An override names a real target of its type: a page, a media file, or a pages folder without an index page in
     * the channel — page references and indexed folders have no URL of their own.
     */
    private void requireOverridableTarget(long projectId, UrlTarget target, ChannelOutputSettings settings) {
        Asset asset = assetRepository.findByProjectIdAndUuid(projectId, target.uuid())
                .orElseThrow(() -> UrlRegistryProblems.invalid("No asset " + target.uuid() + " in the project.", "targetUuid"));
        AssetType expected = switch (target.type()) {
            case PAGE -> AssetType.PAGE;
            case MEDIA -> AssetType.MEDIA;
            case FOLDER -> AssetType.FOLDER;
        };
        if (asset.getAssetType() != expected) {
            String hint = asset.getAssetType() == AssetType.PAGE_REFERENCE
                    ? " A page reference uses the URL of its page."
                    : "";
            throw UrlRegistryProblems.invalid("Asset " + target.uuid() + " is not a " + expected.name().toLowerCase(Locale.ROOT)
                    + "." + hint, "targetUuid");
        }
        if (target.type() == UrlTargetType.FOLDER) {
            AssetVersion version = assetVersionRepository.findByAssetIdAndValidToRevisionIsNull(asset.getId())
                    .filter(v -> !v.isDeleted())
                    .orElseThrow(() -> UrlRegistryProblems.invalid("The folder is deleted.", "targetUuid"));
            if (FolderScope.fromPayload(version.getPayload()) != FolderScope.PAGES) {
                throw UrlRegistryProblems.invalid("Only pages folders have a URL.", "targetUuid");
            }
            if (navigationService.indexPage(projectId, target.uuid(), navigationLookup.withIndexUid(settings.indexUid()))
                    .isPresent()) {
                throw UrlRegistryProblems.invalid(
                        "The folder has an index page; it uses that page's URL.", "targetUuid");
            }
        }
    }

    /**
     * The stored form of a URL: trimmed, forward slashes, relative to the site root (leading slashes stripped). The
     * site root's directory stays {@code ./}.
     */
    static String normalizeUrl(String url) {
        if (url == null) {
            throw UrlRegistryProblems.invalid("url must not be blank.", "url");
        }
        String value = url.trim();
        if (value.isEmpty()) {
            throw UrlRegistryProblems.invalid("url must not be blank.", "url");
        }
        if ("./".equals(value) || "/".equals(value)) {
            return "./";
        }
        while (value.startsWith("/")) {
            value = value.substring(1);
        }
        return value;
    }

    /** A URL inside the site that a build can write the target at. */
    private static void validateUrl(UrlTarget target, String url, ChannelOutputSettings settings) {
        if (url.contains("\\") || url.contains("://") || url.startsWith("//") || url.contains(":")) {
            throw UrlRegistryProblems.invalid("The URL must be a path inside the site, without a scheme.", "url");
        }
        if (url.contains("?") || url.contains("#")) {
            throw UrlRegistryProblems.invalid("The URL must not have a query or a fragment.", "url");
        }
        if (url.chars().anyMatch(Character::isWhitespace)) {
            throw UrlRegistryProblems.invalid("The URL must not contain spaces.", "url");
        }
        String stripped = url.startsWith("./") ? url.substring(2) : url;
        for (String segment : stripped.split("/", -1)) {
            if ("..".equals(segment) || ".".equals(segment)) {
                throw UrlRegistryProblems.invalid("The URL must not contain '.' or '..' segments.", "url");
            }
        }
        if (stripped.contains("//")) {
            throw UrlRegistryProblems.invalid("The URL must not contain empty segments.", "url");
        }
        switch (target.type()) {
            case PAGE -> {
                String path = OutputPathExpander.pathForUrl(url, settings);
                String suffix = "." + settings.extension();
                if (!path.endsWith(suffix)) {
                    throw UrlRegistryProblems.invalid(
                            "A page's URL must name a ." + settings.extension() + " file or a directory.", "url");
                }
            }
            case MEDIA -> {
                if (url.endsWith("/") || "./".equals(url)) {
                    throw UrlRegistryProblems.invalid("A media file's URL must name a file.", "url");
                }
            }
            case FOLDER -> {
                // A folder link may point anywhere inside the site.
            }
        }
    }

    private Optional<UrlRegistryEntry> find(
            long projectId, String channelKey, UrlArea area, String localeKey, UrlTarget target) {
        return repository.findTuple(projectId, channelKey, area, localeKey, target.type(), target.uuid(), target.variant(),
                target.pageNumber());
    }

    private void recordChange(long projectId, UrlArea area, UrlTargetType type, UUID uuid) {
        changes.save(new UrlRegistryChange(projectId, area, type, uuid, Instant.now()));
    }

    /** How {@code {locale}} expands for a stored language key (M24.3.2). */
    private OutputPathExpander.LocaleContext localeContext(long projectId, String localeKey) {
        if (localeKey == null || localeKey.isEmpty()) {
            return OutputPathExpander.LocaleContext.NONE;
        }
        LocaleConfig config = projectLocales.forProject(projectId);
        boolean atRoot = config.defaultWithoutPrefix() && localeKey.equals(config.defaultLocale());
        return new OutputPathExpander.LocaleContext(localeKey, atRoot ? "" : localeKey);
    }

    private long currentRevision(long projectId) {
        List<Revision> recent = revisionService.findRecent(projectId, PageRequest.of(0, 1));
        return recent.isEmpty() ? 0L : recent.get(0).getRevisionId();
    }

    private static String blankToNull(String value) {
        return value == null || value.isBlank() ? null : value;
    }
}
