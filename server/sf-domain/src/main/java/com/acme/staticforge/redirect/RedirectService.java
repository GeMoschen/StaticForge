package com.acme.staticforge.redirect;

import com.acme.staticforge.asset.AssetService;
import com.acme.staticforge.asset.AssetType;
import com.acme.staticforge.asset.AssetVersionView;
import com.acme.staticforge.audit.AuditService;
import com.acme.staticforge.channel.ChannelOutputSettings;
import com.acme.staticforge.channel.ChannelService;
import com.acme.staticforge.common.ProblemFactory;
import com.acme.staticforge.common.SfException;
import com.acme.staticforge.project.LocaleConfig;
import com.acme.staticforge.project.ProjectLocales;
import com.acme.staticforge.project.ProjectWriteGuard;
import com.acme.staticforge.redirect.PublishedOutputs.PublishedBuild;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.time.Clock;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * The redirect registry of a project (M30.4.1, epic decisions 14, 16, 17): the manual API, {@code for-asset}, the
 * registry view with each redirect's state, and the seams the build uses — {@link #upsertAuto} (detection, M30.4.2)
 * and {@link #resolve} (emission; a pure function in {@link RedirectResolver}).
 *
 * <p>Redirects allocate no revision, so every write checks the archived-project guard itself. Manual changes are
 * audited ({@code REDIRECT_CREATED/UPDATED/DELETED}, target {@code redirect:<channel>/<locale>/<fromPath>}); automatic
 * entries are not — their {@code sourceRunId} tells where they came from.
 */
@Service
public class RedirectService {

    private static final JsonNodeFactory JSON = JsonNodeFactory.instance;

    private final RedirectRepository repository;
    private final ChannelService channels;
    private final ProjectLocales locales;
    private final AssetService assets;
    private final PublishedOutputs published;
    private final ProjectWriteGuard writeGuard;
    private final AuditService audit;
    private final Clock clock;

    public RedirectService(
            RedirectRepository repository,
            ChannelService channels,
            ProjectLocales locales,
            AssetService assets,
            PublishedOutputs published,
            ProjectWriteGuard writeGuard,
            AuditService audit,
            Clock clock) {
        this.repository = repository;
        this.channels = channels;
        this.locales = locales;
        this.assets = assets;
        this.published = published;
        this.writeGuard = writeGuard;
        this.audit = audit;
        this.clock = clock;
    }

    /**
     * Filters of {@link #list}; {@code null} (or blank) means any. {@code q} matches the source and fixed target path.
     * {@code state} keeps the rows with that state against the default target's current build — none while nothing is
     * published there, since no row has a state then.
     */
    public record Filter(String channel, String locale, RedirectKind kind, String q, RedirectState state) {

        /** The filters without a state. */
        public Filter(String channel, String locale, RedirectKind kind, String q) {
            this(channel, locale, kind, q, null);
        }
    }

    /**
     * A manual redirect as a request states it. Exactly one of {@code toAssetUuid} (with {@code toPageNumber}, default
     * 1) and {@code toPath} is set; {@code locale} is blank in a project without locales.
     */
    public record Command(
            String channel, String locale, String fromPath, UUID toAssetUuid, Integer toPageNumber, String toPath) {}

    /**
     * A registry row: the entry and — when the default target has a published build — its state there and where it
     * leads ({@link ResolvedRedirect}); both {@code null} without a build.
     */
    public record Row(RedirectEntry entry, RedirectState state, String target) {}

    /** One page of the registry and the run its states were computed against ({@code null}: nothing published). */
    public record Listing(Page<Row> rows, Long basisRunId) {}

    /** An automatic redirect a build detected: the output at {@code fromPath} moved; it now belongs to the asset. */
    public record AutoCandidate(String channel, String locale, String fromPath, UUID toAssetUuid, int toPageNumber) {

        public AutoCandidate {
            locale = locale == null ? "" : locale;
        }
    }

    /** What {@link #upsertAuto} did: new entries, re-pointed {@code AUTO} entries, and candidates a manual entry kept. */
    public record AutoResult(int added, int replaced, int keptManual) {}

    // ------------------------------------------------------------------
    // Reading
    // ------------------------------------------------------------------

    /** One page of the project's registry, each row resolved against the default target's current build. */
    @Transactional(readOnly = true)
    public Listing list(long projectId, Filter filter, Pageable pageable) {
        Optional<PublishedBuild> build = published.current(projectId);
        Long basisRunId = build.map(PublishedBuild::runId).orElse(null);
        if (filter.state() != null) {
            return new Listing(listByState(projectId, filter, build, pageable), basisRunId);
        }
        Page<RedirectEntry> page = search(projectId, filter, pageable);
        Map<Long, ResolvedRedirect> resolved = build.isPresent() && page.hasContent()
                ? resolvedById(projectId, build.get().outputs())
                : Map.of();
        return new Listing(page.map(entry -> row(entry, resolved)), basisRunId);
    }

    /**
     * A state is computed, not stored: the other filters select in the database, every match is resolved against the
     * build (the resolver needs the whole registry anyway, for chains and loops), and the page is cut from the rows
     * with the requested state.
     */
    private Page<Row> listByState(long projectId, Filter filter, Optional<PublishedBuild> build, Pageable pageable) {
        if (build.isEmpty()) {
            return Page.empty(pageable);
        }
        Map<Long, ResolvedRedirect> resolved = resolvedById(projectId, build.get().outputs());
        List<Row> matching = search(projectId, filter, Pageable.unpaged()).stream()
                .map(entry -> row(entry, resolved))
                .filter(row -> row.state() == filter.state())
                .toList();
        int from = (int) Math.min(pageable.getOffset(), matching.size());
        int to = Math.min(from + pageable.getPageSize(), matching.size());
        return new PageImpl<>(matching.subList(from, to), pageable, matching.size());
    }

    private Page<RedirectEntry> search(long projectId, Filter filter, Pageable pageable) {
        return repository.search(
                projectId,
                blankToNull(filter.channel()),
                filter.locale() == null || filter.locale().isBlank() ? null : filter.locale().trim(),
                filter.kind(),
                escapeLike(blankToNull(filter.q())),
                pageable);
    }

    /** One redirect with its state against the default target's current build. */
    @Transactional(readOnly = true)
    public Row get(long projectId, long id) {
        RedirectEntry entry = require(projectId, id);
        Map<Long, ResolvedRedirect> resolved = published.current(projectId)
                .map(build -> resolvedById(projectId, build.outputs()))
                .orElse(Map.of());
        return row(entry, resolved);
    }

    /** {@code entries} of the project as rows, resolved against the default target's current build (read once). */
    @Transactional(readOnly = true)
    public List<Row> rows(long projectId, List<RedirectEntry> entries) {
        Map<Long, ResolvedRedirect> resolved = entries.isEmpty()
                ? Map.of()
                : published.current(projectId).map(build -> resolvedById(projectId, build.outputs())).orElse(Map.of());
        return entries.stream().map(entry -> row(entry, resolved)).toList();
    }

    /** The redirect {@code id} of the project; {@code 404 SF-DOM-0190} otherwise. */
    @Transactional(readOnly = true)
    public RedirectEntry require(long projectId, long id) {
        return repository.findByIdAndProjectId(id, projectId).orElseThrow(() -> RedirectProblems.notFound(id));
    }

    /** Every redirect of the project, sorted by channel, locale and source path (the build, the archive). */
    @Transactional(readOnly = true)
    public List<RedirectEntry> all(long projectId) {
        return repository.findByProjectIdOrderByChannelKeyAscLocaleKeyAscFromPathAsc(projectId);
    }

    /** The default target's current build (see {@link PublishedOutputs}). */
    public Optional<PublishedBuild> currentBuild(long projectId) {
        return published.current(projectId);
    }

    /**
     * {@code rules} resolved against {@code outputs} (epic decision 16) — see {@link RedirectResolver#resolve}. The
     * build passes the persisted redirects plus its new candidates and its own outputs; only
     * {@link RedirectState#ACTIVE} ones are written.
     */
    public List<ResolvedRedirect> resolve(List<RedirectRule> rules, RedirectOutputs outputs) {
        return RedirectResolver.resolve(rules, outputs);
    }

    // ------------------------------------------------------------------
    // Manual redirects
    // ------------------------------------------------------------------

    /**
     * Creates a manual redirect. {@code 422 SF-DOM-0193} for an invalid channel, locale, source or target, {@code 409
     * SF-DOM-0191} when the source path already redirects, {@code 422 SF-DOM-0192} when it would lead back to itself.
     */
    @Transactional
    public RedirectEntry create(long projectId, Command command, long actorUserId) {
        writeGuard.requireWritable(projectId);
        Target target = validate(projectId, command);
        if (repository.findByProjectIdAndChannelKeyAndLocaleKeyAndFromPath(
                projectId, target.channel(), target.locale(), target.fromPath()).isPresent()) {
            throw RedirectProblems.duplicateSource(target.channel(), target.locale(), target.fromPath());
        }
        requireNoLoop(projectId, target.rule(null), currentOutputs(projectId));
        Instant now = clock.instant();
        RedirectEntry entry = new RedirectEntry(
                projectId, target.channel(), target.locale(), target.fromPath(), RedirectKind.MANUAL, now, actorUserId);
        target.applyTo(entry);
        entry = saveUnique(entry);
        record(entry, actorUserId, "REDIRECT_CREATED", detail(entry));
        return entry;
    }

    /**
     * Replaces a redirect read at {@code expectedVersion} ({@code 409 SF-API-0409} when stale). An {@code AUTO} entry
     * becomes {@code MANUAL}: someone now owns it, so detection never overwrites it. Validation as in {@link #create}.
     */
    @Transactional
    public RedirectEntry update(long projectId, long id, long expectedVersion, Command command, long actorUserId) {
        writeGuard.requireWritable(projectId);
        RedirectEntry entry = require(projectId, id);
        requireVersion(entry, expectedVersion);
        Target target = validate(projectId, command);
        Optional<RedirectEntry> clash = repository.findByProjectIdAndChannelKeyAndLocaleKeyAndFromPath(
                projectId, target.channel(), target.locale(), target.fromPath());
        if (clash.isPresent() && !clash.get().getId().equals(entry.getId())) {
            throw RedirectProblems.duplicateSource(target.channel(), target.locale(), target.fromPath());
        }
        requireNoLoop(projectId, target.rule(entry.getId()), currentOutputs(projectId));
        ObjectNode detail = JSON.objectNode();
        detail.set("before", detail(entry));
        entry.setChannelKey(target.channel());
        entry.setLocaleKey(target.locale());
        entry.setFromPath(target.fromPath());
        entry.setKind(RedirectKind.MANUAL);
        target.applyTo(entry);
        entry.touched(clock.instant(), actorUserId);
        entry = saveUnique(entry);
        detail.setAll(detail(entry));
        record(entry, actorUserId, "REDIRECT_UPDATED", detail);
        return entry;
    }

    /**
     * Deletes a redirect; with {@code expectedVersion} only when it is still at that version ({@code 409 SF-API-0409}).
     * Deleting an {@code AUTO} entry is allowed: it comes back only when the path changes again.
     */
    @Transactional
    public void delete(long projectId, long id, Long expectedVersion, long actorUserId) {
        writeGuard.requireWritable(projectId);
        RedirectEntry entry = require(projectId, id);
        if (expectedVersion != null) {
            requireVersion(entry, expectedVersion);
        }
        repository.delete(entry);
        repository.flush();
        record(entry, actorUserId, "REDIRECT_DELETED", detail(entry));
    }

    /**
     * Redirects every current output of {@code assetUuid} — each page output in the default target's current build, in
     * every channel, locale and page number — to {@code toAssetUuid} (page 1) or {@code toPath}: the "Redirect old URL
     * to…" of the unpublish and delete dialogs. A redirect that already exists for such a path is replaced (it is the
     * explicit intent); all results are {@code MANUAL}. {@code 422 SF-DOM-0194} when the asset has no output there,
     * {@code 0193} for an invalid target, {@code 0192} for a target that is the asset itself or one of its paths.
     *
     * @return the created or replaced redirects, sorted by channel, locale and source path
     */
    @Transactional
    public List<RedirectEntry> createForAsset(long projectId, UUID assetUuid, UUID toAssetUuid, String toPath, long actorUserId) {
        writeGuard.requireWritable(projectId);
        if (assetUuid == null) {
            throw RedirectProblems.invalid("assetUuid is required.", "assetUuid");
        }
        if ((toAssetUuid == null) == (toPath == null || toPath.isBlank())) {
            throw RedirectProblems.invalid("Give exactly one target: toAssetUuid or toPath.", "toPath");
        }
        if (assetUuid.equals(toAssetUuid)) {
            throw RedirectProblems.loop("A page can't redirect to itself.");
        }
        PublishedBuild build = published.current(projectId).orElseThrow(() -> RedirectProblems.noOutput(
                "Nothing is published to the default target, so the asset has no output to redirect."));
        List<RedirectOutputs.PageOutput> outputs = build.outputs().pagesOf(assetUuid);
        if (outputs.isEmpty()) {
            throw RedirectProblems.noOutput("Asset " + assetUuid + " has no output in the default target's current build.");
        }
        if (toAssetUuid != null) {
            requirePage(projectId, toAssetUuid);
        }
        Map<String, ChannelOutputSettings> settings = channels.outputSettings(projectId);
        Instant now = clock.instant();
        List<RedirectEntry> result = new ArrayList<>();
        for (RedirectOutputs.PageOutput output : sorted(outputs)) {
            String channel = output.key().channel();
            String locale = output.key().locale();
            String fixed = toPath == null || toPath.isBlank()
                    ? null
                    : RedirectPaths.target(toPath, indexFileName(settings, channel), "toPath");
            Optional<RedirectEntry> existing = repository.findByProjectIdAndChannelKeyAndLocaleKeyAndFromPath(
                    projectId, channel, locale, output.path());
            Long id = existing.map(RedirectEntry::getId).orElse(null);
            RedirectRule rule = fixed == null
                    ? new RedirectRule(id, channel, locale, output.path(), toAssetUuid, 1, null)
                    : new RedirectRule(id, channel, locale, output.path(), null, null, fixed);
            requireNoLoop(projectId, rule, build.outputs());
            RedirectEntry entry;
            ObjectNode detail = JSON.objectNode();
            if (existing.isPresent()) {
                entry = existing.get();
                detail.set("before", detail(entry));
                entry.setKind(RedirectKind.MANUAL);
                entry.touched(now, actorUserId);
            } else {
                entry = new RedirectEntry(projectId, channel, locale, output.path(), RedirectKind.MANUAL, now, actorUserId);
            }
            if (fixed == null) {
                entry.targetAsset(toAssetUuid, 1);
            } else {
                entry.targetPath(fixed);
            }
            entry = saveUnique(entry);
            detail.setAll(detail(entry));
            detail.put("forAsset", assetUuid.toString());
            record(entry, actorUserId, existing.isPresent() ? "REDIRECT_UPDATED" : "REDIRECT_CREATED", detail);
            result.add(entry);
        }
        return result;
    }

    // ------------------------------------------------------------------
    // Automatic redirects (M30.4.2)
    // ------------------------------------------------------------------

    /**
     * Stores the redirects build {@code sourceRunId} detected (M30.4.2, epic decision 16): each candidate re-points the
     * {@code AUTO} entry of its source path, or becomes a new {@code AUTO} entry; a {@code MANUAL} entry of that path is
     * never touched. Not audited, no archived guard (the build started while the project was writable). Runs in the
     * caller's transaction (the build's report); atomic per candidate, so a manual redirect created concurrently for
     * the same path wins without failing the build.
     */
    @Transactional
    public AutoResult upsertAuto(long projectId, long sourceRunId, List<AutoCandidate> candidates) {
        Instant now = clock.instant();
        int added = 0;
        int replaced = 0;
        int keptManual = 0;
        for (AutoCandidate candidate : candidates) {
            Objects.requireNonNull(candidate.toAssetUuid(), "toAssetUuid");
            if (candidate.fromPath() == null || candidate.fromPath().isBlank()) {
                throw new IllegalArgumentException("An automatic redirect needs a source path.");
            }
            int page = Math.max(1, candidate.toPageNumber());
            if (repository.updateAuto(projectId, candidate.channel(), candidate.locale(), candidate.fromPath(),
                    candidate.toAssetUuid(), page, sourceRunId, now) > 0) {
                replaced++;
            } else if (repository.insertAutoIfAbsent(projectId, candidate.channel(), candidate.locale(),
                    candidate.fromPath(), candidate.toAssetUuid(), page, sourceRunId, now) > 0) {
                added++;
            } else {
                keptManual++;
            }
        }
        return new AutoResult(added, replaced, keptManual);
    }

    // ------------------------------------------------------------------
    // Validation
    // ------------------------------------------------------------------

    /** A validated, normalized manual redirect. */
    private record Target(String channel, String locale, String fromPath, UUID toAssetUuid, Integer toPageNumber, String toPath) {

        RedirectRule rule(Long id) {
            return new RedirectRule(id, channel, locale, fromPath, toAssetUuid, toPageNumber, toPath);
        }

        void applyTo(RedirectEntry entry) {
            if (toAssetUuid != null) {
                entry.targetAsset(toAssetUuid, toPageNumber);
            } else {
                entry.targetPath(toPath);
            }
        }
    }

    private Target validate(long projectId, Command command) {
        String channel = command.channel() == null ? "" : command.channel().trim();
        Map<String, ChannelOutputSettings> settings = channels.outputSettings(projectId);
        if (channel.isEmpty() || !settings.containsKey(channel)) {
            throw RedirectProblems.invalid(channel.isEmpty() ? "channel is required." : "Unknown channel '" + channel + "'.",
                    "channel");
        }
        String locale = locale(projectId, command.locale());
        String indexFileName = settings.get(channel).indexFileName();
        String fromPath = RedirectPaths.source(command.fromPath(), indexFileName, "fromPath");
        boolean hasPath = command.toPath() != null && !command.toPath().isBlank();
        if ((command.toAssetUuid() == null) == !hasPath) {
            throw RedirectProblems.invalid("Give exactly one target: toAssetUuid or toPath.", "toPath");
        }
        if (hasPath) {
            if (command.toPageNumber() != null) {
                throw RedirectProblems.invalid("toPageNumber belongs to a page target, not to toPath.", "toPageNumber");
            }
            return new Target(channel, locale, fromPath, null, null, RedirectPaths.target(command.toPath(), indexFileName, "toPath"));
        }
        int page = command.toPageNumber() == null ? 1 : command.toPageNumber();
        if (page < 1) {
            throw RedirectProblems.invalid("toPageNumber starts at 1.", "toPageNumber");
        }
        requirePage(projectId, command.toAssetUuid());
        return new Target(channel, locale, fromPath, command.toAssetUuid(), page, null);
    }

    /** The locale key of a redirect: a declared locale in a localized project, {@code ""} otherwise. */
    private String locale(long projectId, String raw) {
        LocaleConfig config = locales.forProject(projectId);
        String value = raw == null ? "" : raw.trim();
        if (!config.isLocalized()) {
            if (!value.isEmpty()) {
                throw RedirectProblems.invalid("The project has no languages; leave locale empty.", "locale");
            }
            return "";
        }
        String declared = config.canonicalDeclared(value);
        if (declared == null) {
            throw RedirectProblems.invalid(value.isEmpty()
                    ? "locale is required: the project has languages (" + String.join(", ", config.codes()) + ")."
                    : "Unknown locale '" + value + "'.", "locale");
        }
        return declared;
    }

    /** {@code uuid} is a live page of the project; {@code 422 SF-DOM-0193} otherwise. */
    private void requirePage(long projectId, UUID uuid) {
        AssetVersionView page;
        try {
            page = assets.requireCurrent(projectId, uuid);
        } catch (SfException notFound) {
            throw RedirectProblems.invalid("There is no page " + uuid + " in this project.", "toAssetUuid");
        }
        if (page.type() != AssetType.PAGE || page.deleted()) {
            throw RedirectProblems.invalid(page.deleted()
                    ? "Page " + uuid + " is deleted."
                    : uuid + " is not a page (" + page.type() + ").", "toAssetUuid");
        }
    }

    /**
     * {@code 422 SF-DOM-0192} when {@code rule} leads back to its own source path: directly, because its target page is
     * at that path in {@code outputs}, or through the other redirects of its channel and locale.
     */
    private void requireNoLoop(long projectId, RedirectRule rule, RedirectOutputs outputs) {
        String target = RedirectResolver.target(rule, outputs);
        if (target != null && rule.fromPath().equals(RedirectPaths.pathOf(target))) {
            throw RedirectProblems.loop(rule.toAssetUuid() != null
                    ? "The target page is published at '" + rule.fromPath() + "' itself."
                    : "'" + rule.fromPath() + "' can't redirect to itself.");
        }
        Map<String, RedirectRule> others = new HashMap<>();
        for (RedirectEntry entry : repository.findByProjectIdAndChannelKeyAndLocaleKey(projectId, rule.channel(), rule.locale())) {
            if (!entry.getFromPath().equals(rule.fromPath()) && !Objects.equals(entry.getId(), rule.id())) {
                others.put(entry.getFromPath(), entry.rule());
            }
        }
        Set<String> seen = new HashSet<>();
        String path = RedirectPaths.pathOf(target);
        while (path != null && seen.add(path)) {
            RedirectRule next = others.get(path);
            if (next == null) {
                return;
            }
            path = RedirectPaths.pathOf(RedirectResolver.target(next, outputs));
            if (rule.fromPath().equals(path)) {
                throw RedirectProblems.loop("'" + rule.fromPath() + "' would lead back to itself through the redirect from '"
                        + next.fromPath() + "'.");
            }
        }
        if (path != null) {
            throw RedirectProblems.loop("'" + rule.fromPath() + "' would lead into a redirect loop.");
        }
    }

    // ------------------------------------------------------------------
    // Helpers
    // ------------------------------------------------------------------

    private RedirectOutputs currentOutputs(long projectId) {
        return published.current(projectId).map(PublishedBuild::outputs).orElse(RedirectOutputs.EMPTY);
    }

    private Map<Long, ResolvedRedirect> resolvedById(long projectId, RedirectOutputs outputs) {
        List<RedirectEntry> entries = all(projectId);
        List<ResolvedRedirect> resolved = RedirectResolver.resolve(entries.stream().map(RedirectEntry::rule).toList(), outputs);
        Map<Long, ResolvedRedirect> byId = new HashMap<>();
        resolved.forEach(r -> byId.put(r.rule().id(), r));
        return byId;
    }

    private static Row row(RedirectEntry entry, Map<Long, ResolvedRedirect> resolved) {
        ResolvedRedirect r = resolved.get(entry.getId());
        return r == null ? new Row(entry, null, null) : new Row(entry, r.state(), r.target());
    }

    private static List<RedirectOutputs.PageOutput> sorted(List<RedirectOutputs.PageOutput> outputs) {
        return outputs.stream()
                .sorted((a, b) -> {
                    int c = a.key().channel().compareTo(b.key().channel());
                    c = c != 0 ? c : a.key().locale().compareTo(b.key().locale());
                    return c != 0 ? c : a.path().compareTo(b.path());
                })
                .toList();
    }

    private static String indexFileName(Map<String, ChannelOutputSettings> settings, String channel) {
        ChannelOutputSettings s = settings.get(channel);
        return (s == null ? ChannelOutputSettings.defaults(channel) : s).indexFileName();
    }

    private static void requireVersion(RedirectEntry entry, long expectedVersion) {
        if (entry.getVersion() != expectedVersion) {
            throw new SfException(ProblemFactory.conflict(
                    "The redirect was changed by someone else (version " + entry.getVersion() + "); reload it."));
        }
    }

    /** Saves and flushes, turning a lost race on {@code uq_redirect_source} into {@code 409 SF-DOM-0191}. */
    private RedirectEntry saveUnique(RedirectEntry entry) {
        try {
            return repository.saveAndFlush(entry);
        } catch (DataIntegrityViolationException e) {
            throw RedirectProblems.duplicateSource(entry.getChannelKey(), entry.getLocaleKey(), entry.getFromPath());
        }
    }

    private void record(RedirectEntry entry, long actorUserId, String action, ObjectNode detail) {
        audit.record(entry.getProjectId(), actorUserId, action,
                "redirect:" + entry.getChannelKey() + "/" + entry.getLocaleKey() + "/" + entry.getFromPath(), detail);
    }

    private static ObjectNode detail(RedirectEntry entry) {
        ObjectNode node = JSON.objectNode();
        node.put("id", entry.getId());
        node.put("kind", entry.getKind().name());
        node.put("channel", entry.getChannelKey());
        node.put("locale", entry.getLocaleKey());
        node.put("fromPath", entry.getFromPath());
        if (entry.getToAssetUuid() != null) {
            node.put("toAssetUuid", entry.getToAssetUuid().toString());
            node.put("toPageNumber", entry.getToPageNumber());
        } else {
            node.put("toPath", entry.getToPath());
        }
        return node;
    }

    private static String blankToNull(String value) {
        return value == null || value.isBlank() ? null : value.trim();
    }

    private static String escapeLike(String value) {
        return value == null ? null : value.replace("!", "!!").replace("%", "!%").replace("_", "!_");
    }
}
