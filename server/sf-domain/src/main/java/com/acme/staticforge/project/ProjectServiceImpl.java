package com.acme.staticforge.project;

import com.acme.staticforge.asset.AssetService;
import com.acme.staticforge.asset.content.LocalizationContext;
import com.acme.staticforge.asset.localization.LocalizationMigrationService;
import com.acme.staticforge.audit.AuditService;
import com.acme.staticforge.channel.ChannelService;
import com.acme.staticforge.common.ProblemFactory;
import com.acme.staticforge.common.SfException;
import com.acme.staticforge.release.ReleaseLocaleTransition;
import com.acme.staticforge.revision.AssetChange;
import com.acme.staticforge.revision.ChangeType;
import com.acme.staticforge.revision.Revision;
import com.acme.staticforge.revision.RevisionAware;
import com.acme.staticforge.revision.RevisionContext;
import com.acme.staticforge.revision.RevisionCounterRepository;
import com.acme.staticforge.revision.RevisionService;
import com.acme.staticforge.user.UserService;
import com.acme.staticforge.user.UserStatus;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.regex.Pattern;
import org.springframework.data.domain.Sort;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * {@link ProjectService} implementation. Carries {@link RevisionAware} so it may write
 * through the project/member repositories; memberships are stored here and every mutation
 * is paired with an allocated revision (spec §21.2).
 */
@Service
@RevisionAware
public class ProjectServiceImpl implements ProjectService {

    private static final Pattern KEY_PATTERN = Pattern.compile("[a-z0-9](?:[a-z0-9_-]*[a-z0-9])?");

    private static final String MEMBER_ASSET_TYPE = "USER";

    private final ProjectRepository projectRepository;
    private final ProjectMemberRepository projectMemberRepository;
    private final RevisionService revisionService;
    private final RevisionCounterRepository counterRepository;
    private final ChannelService channelService;
    private final AuditService auditService;
    private final ObjectMapper objectMapper;
    private final AssetService assetService;
    private final LocalizationMigrationService localizationMigrations;
    private final UserService userService;
    private final ProjectWriteGuard writeGuard;
    private final ReleaseLocaleTransition releaseLocaleTransition;
    /**
     * Lazily resolved: the search index is an optional companion of the project service, and a hard
     * dependency here would tie project writes to the index being constructible.
     */
    private final org.springframework.beans.factory.ObjectProvider<com.acme.staticforge.search.SearchIndexer> searchIndexer;

    private static final org.slf4j.Logger LOG = org.slf4j.LoggerFactory.getLogger(ProjectServiceImpl.class);

    public ProjectServiceImpl(
            ProjectRepository projectRepository,
            ProjectMemberRepository projectMemberRepository,
            RevisionService revisionService,
            RevisionCounterRepository counterRepository,
            ChannelService channelService,
            AuditService auditService,
            ObjectMapper objectMapper,
            AssetService assetService,
            LocalizationMigrationService localizationMigrations,
            UserService userService,
            ProjectWriteGuard writeGuard,
            ReleaseLocaleTransition releaseLocaleTransition,
            org.springframework.beans.factory.ObjectProvider<com.acme.staticforge.search.SearchIndexer> searchIndexer) {
        this.projectRepository = projectRepository;
        this.projectMemberRepository = projectMemberRepository;
        this.revisionService = revisionService;
        this.counterRepository = counterRepository;
        this.channelService = channelService;
        this.auditService = auditService;
        this.localizationMigrations = localizationMigrations;
        this.userService = userService;
        this.writeGuard = writeGuard;
        this.releaseLocaleTransition = releaseLocaleTransition;
        this.searchIndexer = searchIndexer;
        this.objectMapper = objectMapper;
        this.assetService = assetService;
    }

    @Override
    @Transactional
    public Project create(CreateProjectRequest cmd, Long actingUserId) {
        String key = validateKey(cmd.key());
        if (projectRepository.existsByKey(key)) {
            throw new SfException(ProblemFactory.other(
                    409, "SF-DOM-0140", "Conflict", "A project with this key already exists."));
        }

        Project project = new Project(key, cmd.name(), Instant.now(), actingUserId);
        project.setDescription(cmd.description());
        project = projectRepository.save(project);

        counterRepository.initialize(project.getId());

        // Project creation is one user-facing action that bootstraps several assets (the
        // project itself, plus every fixed template/navigation/pages/media root folder below)
        // — open one batch revision up front and thread it through every nested call so they
        // all join it via allocateOrJoin instead of each allocating its own (spec §7.1).
        Revision batch = revisionService.beginBatch(project.getId(), ChangeType.CREATE, cmd.comment(), actingUserId);
        RevisionContext creationCtx = RevisionContext.joining(batch, actingUserId, cmd.comment());

        // The project itself isn't an Asset, but its creation is still the batch's first
        // logical entry — reuse AssetChange's uuid/type/uid/action shape (a synthetic
        // "project-<id>" uuid, type "PROJECT") so every reader of summary.assets only ever
        // has to understand one entry shape per revision.
        revisionService.appendSummary(
                project.getId(),
                batch.getRevisionId(),
                AssetChange.create("project-" + project.getId(), "PROJECT", "CREATE", List.of()));

        ProjectMember member = new ProjectMember(project.getId(), actingUserId, ProjectRole.PROJECT_ADMIN, Instant.now());
        member.setGrantedBy(actingUserId);
        projectMemberRepository.save(member);

        // Channel bootstrap deliberately stays revision-untracked (see
        // ChannelService#ensureDefaultChannels) even though it now takes the batch-carrying
        // ctx: the default html channel isn't an Asset and isn't part of the epic's "8 -> 1
        // revision" proof case (summary.assets is specified as the project + its 7 bootstrap
        // folders), so joining it into the batch would just be unused plumbing today.
        channelService.ensureDefaultChannels(creationCtx);

        // The template store's top level is fixed to exactly these two protected folders,
        // themselves nested under a fixed "All Templates" wrapper root (spec M13.1.2, later
        // generalized) — auto-provisioned immediately so template creation never has to
        // special-case a missing parent.
        assetService.ensureTemplateFolders(project.getId(), creationCtx);

        // The navigation store's top level is a single fixed, protected "All Navigation" root —
        // every top-level nav folder/reference nests under it, and it's the one place a
        // project-wide navigation entry point can be set.
        assetService.ensureNavigationRootFolder(project.getId(), creationCtx);

        // The pages/media stores each get the same fixed, protected wrapper root treatment as
        // navigation ("All Pages" / "All Media") — every top-level folder or loose leaf of that
        // store nests under it, so no page/media asset is ever a direct, ambiguous child of the
        // project's shared hidden root.
        assetService.ensurePagesRootFolder(project.getId(), creationCtx);
        assetService.ensureMediaRootFolder(project.getId(), creationCtx);

        // The globals store (M17.1.1) gets the same treatment — a fixed, protected "All Globals"
        // root that every property set and Globals folder nests under.
        assetService.ensureGlobalsRootFolder(project.getId(), creationCtx);

        // The Content store (M19.1.1): a fixed, protected "All Content" root for dataset records and
        // their folders. The dataset schema folder comes with ensureTemplateFolders above.
        assetService.ensureContentRootFolder(project.getId(), creationCtx);

        return project;
    }

    @Override
    @Transactional(readOnly = true)
    public Optional<Project> findByKey(String key) {
        return projectRepository.findByKey(key);
    }

    @Override
    @Transactional(readOnly = true)
    public Project requireByKey(String key) {
        return projectRepository.findByKey(key)
                .orElseThrow(() -> new SfException(ProblemFactory.notFound("Project not found.")));
    }

    @Override
    @Transactional(readOnly = true)
    public Project requireWritable(String key) {
        Project project = requireByKey(key);
        writeGuard.requireWritable(project);
        return project;
    }

    @Override
    @Transactional(readOnly = true)
    public List<Project> listAll() {
        return projectRepository.findAll(Sort.by(Sort.Direction.ASC, "key"));
    }

    @Override
    @Transactional
    public Project update(String key, String name, String description, List<String> allowedMimeTypes, RevisionContext ctx) {
        Project project = requireByKey(key);
        project.setName(name);
        project.setDescription(description);
        project.setAllowedMimeTypes(joinMimeTypes(allowedMimeTypes));
        projectRepository.save(project);
        revisionService.allocate(project.getId(), ChangeType.UPDATE, ctx.comment(), ctx.userId());
        return project;
    }

    @Override
    @Transactional
    public LocaleUpdateResult updateLocales(String key, LocaleConfig config, boolean confirmDiscard, RevisionContext ctx) {
        Project project = requireByKey(key);
        LocaleConfig before = decodeLocales(project);
        LocaleConfig after = config == null ? LocaleConfig.EMPTY : config;
        LocalizationContext target = LocalizationContext.of(after);

        boolean urlsWillChange = before.isLocalized() != after.isLocalized()
                || (after.isLocalized() && before.defaultWithoutPrefix() != after.defaultWithoutPrefix());
        List<String> removed = before.codes().stream().filter(c -> !after.declares(c)).toList();

        // A project giving up its locales unwraps every localizable value down to one language,
        // so the caller confirms first. The dry run is what the confirmation dialog shows.
        LocalizationMigrationService.MigrationReport preview =
                localizationMigrations.migrateProject(project.getId(), target, ctx, false);
        if (preview.requiresConfirmation() && !confirmDiscard) {
            return new LocaleUpdateResult(
                    before,
                    urlsWillChange,
                    removed,
                    localizedValueCount(project.getId(), removed),
                    true,
                    preview.discardedLocaleValues(),
                    preview.affectedAssets());
        }

        // The settings change and the content it migrates are one logical change, so they share
        // one revision (spec §7.1, M15 batch mechanism).
        Revision batch = revisionService.beginBatch(project.getId(), ChangeType.UPDATE, ctx.comment(), ctx.userId());
        RevisionContext batchCtx = RevisionContext.joining(batch, ctx.userId(), ctx.comment());

        project.setLocaleConfig(after.isLocalized() || after.defaultWithoutPrefix()
                ? objectMapper.valueToTree(after)
                : null);
        projectRepository.save(project);

        LocalizationMigrationService.MigrationReport applied =
                localizationMigrations.migrateProject(project.getId(), target, batchCtx, true);
        // Release pointers follow the locale set in the same revision (M27.1.1): removed locales close,
        // a project gaining or losing its locales converts between per-locale and "all locales" pointers.
        releaseLocaleTransition.apply(project.getId(), before, after, batch.getRevisionId());

        // A changed language set changes which analyzer each value is indexed with, so the index is
        // rebuilt rather than left describing the old set (M24.3.3). A failure here must not fail the
        // settings change: the index catches up on the next sync either way.
        if (!before.codes().equals(after.codes())) {
            try {
                com.acme.staticforge.search.SearchIndexer indexer = searchIndexer.getIfAvailable();
                if (indexer != null) {
                    indexer.requestRebuild(project.getId());
                }
            } catch (RuntimeException e) {
                LOG.warn("Could not request a search reindex after a language change of project {}", project.getId(), e);
            }
        }

        return new LocaleUpdateResult(
                after,
                urlsWillChange,
                removed,
                localizedValueCount(project.getId(), removed),
                false,
                applied.discardedLocaleValues(),
                applied.affectedAssets());
    }

    @Override
    @Transactional(readOnly = true)
    public LocaleConfig locales(String key) {
        return decodeLocales(requireByKey(key));
    }

    @Override
    @Transactional(readOnly = true)
    public LocaleConfig localesById(Long projectId) {
        return projectRepository.findById(projectId).map(this::decodeLocales).orElse(LocaleConfig.EMPTY);
    }

    /**
     * How many stored content values still carry a translation for one of {@code locales} —
     * what the settings UI shows when a locale is removed. The values are kept, not deleted, so
     * re-adding the locale restores them.
     */
    private int localizedValueCount(Long projectId, List<String> locales) {
        return locales.isEmpty() ? 0 : localizationMigrations.countValuesForLocales(projectId, locales);
    }

    private LocaleConfig decodeLocales(Project project) {
        return ProjectLocales.decode(project.getLocaleConfig(), objectMapper);
    }

    private static String joinMimeTypes(List<String> patterns) {
        if (patterns == null || patterns.isEmpty()) {
            return null;
        }
        String joined = patterns.stream()
                .map(String::trim)
                .filter(p -> !p.isBlank())
                .collect(java.util.stream.Collectors.joining(","));
        return joined.isBlank() ? null : joined;
    }

    @Override
    @Transactional
    public void archive(String key, RevisionContext ctx) {
        setArchived(key, true, "PROJECT_ARCHIVED", ctx);
    }

    @Override
    @Transactional
    public void unarchive(String key, RevisionContext ctx) {
        setArchived(key, false, "PROJECT_UNARCHIVED", ctx);
    }

    private void setArchived(String key, boolean archived, String auditAction, RevisionContext ctx) {
        Project project = requireByKey(key);
        if (project.isArchived() == archived) {
            return;
        }
        project.setArchived(archived);
        projectRepository.save(project);

        // Flipping the flag is the one write the archived guard admits, in both directions.
        Revision revision =
                revisionService.allocateEvenIfArchived(project.getId(), ChangeType.UPDATE, ctx.comment(), ctx.userId());
        revisionService.appendSummary(
                project.getId(),
                revision.getRevisionId(),
                AssetChange.create("project-" + project.getId(), "PROJECT", "UPDATE", List.of("archived")));
        auditService.record(project.getId(), ctx.userId(), auditAction, "project:" + key);

        // Access tokens list only the projects that aren't archived: every member's next request must resolve the
        // new state (spec §9.2) instead of the one their current token was issued with.
        for (ProjectMember member : projectMemberRepository.findByProjectIdOrderByUserIdAsc(project.getId())) {
            userService.revokeAccess(member.getUserId());
        }
    }

    @Override
    @Transactional(readOnly = true)
    public List<ProjectMember> members(String key) {
        Project project = requireByKey(key);
        return projectMemberRepository.findByProjectIdOrderByUserIdAsc(project.getId());
    }

    @Override
    @Transactional
    public void setMemberRole(String key, Long userId, ProjectRole role, RevisionContext ctx) {
        Project project = requireByKey(key);

        ProjectMember member = projectMemberRepository
                .findByProjectIdAndUserId(project.getId(), userId)
                .orElseGet(() -> {
                    UserStatus status = userService.requireById(userId).getStatus();
                    if (status == UserStatus.DISABLED || status == UserStatus.DELETED) {
                        throw new SfException(ProblemFactory.conflict(
                                "A " + status.name().toLowerCase(java.util.Locale.ROOT)
                                        + " account can't be added to a project."));
                    }
                    return new ProjectMember(project.getId(), userId, role, Instant.now());
                });
        member.setRole(role);
        member.setGrantedBy(ctx.userId());
        projectMemberRepository.save(member);

        Revision revision = revisionService.allocate(project.getId(), ChangeType.UPDATE, ctx.comment(), ctx.userId());
        revisionService.appendSummary(
                project.getId(),
                revision.getRevisionId(),
                AssetChange.create(memberUuid(userId), MEMBER_ASSET_TYPE, "UPDATE", List.of("role")));

        auditService.record(
                project.getId(), ctx.userId(), "MEMBER_ROLE_SET", "member:" + userId, memberDetail(userId, role.name()));
        // The access token carries the project roles: the change applies on the user's next request (spec §9.2).
        userService.revokeAccess(userId);
    }

    @Override
    @Transactional
    public void removeMember(String key, Long userId, RevisionContext ctx) {
        removeMembership(key, userId, ctx, false);
    }

    @Override
    @Transactional
    public void removeMemberOfDeletedAccount(String key, Long userId, RevisionContext ctx) {
        removeMembership(key, userId, ctx, true);
    }

    private void removeMembership(String key, Long userId, RevisionContext ctx, boolean evenIfArchived) {
        Project project = requireByKey(key);
        projectMemberRepository.deleteByProjectIdAndUserId(project.getId(), userId);

        Revision revision = evenIfArchived
                ? revisionService.allocateEvenIfArchived(project.getId(), ChangeType.UPDATE, ctx.comment(), ctx.userId())
                : revisionService.allocate(project.getId(), ChangeType.UPDATE, ctx.comment(), ctx.userId());
        revisionService.appendSummary(
                project.getId(),
                revision.getRevisionId(),
                AssetChange.create(memberUuid(userId), MEMBER_ASSET_TYPE, "DELETE", List.of()));

        auditService.record(project.getId(), ctx.userId(), "MEMBER_REMOVED", "member:" + userId, memberDetail(userId, null));
        userService.revokeAccess(userId);
    }

    @Override
    @Transactional(readOnly = true)
    public List<ProjectMember> membershipsOf(Long userId) {
        return projectMemberRepository.findByUserId(userId);
    }

    private static String validateKey(String key) {
        if (key == null || key.isBlank()) {
            throw new SfException(ProblemFactory.badRequest("Project key must not be blank."));
        }
        if (key.length() > 40) {
            throw new SfException(ProblemFactory.badRequest("Project key must be at most 40 characters."));
        }
        if (!KEY_PATTERN.matcher(key).matches()) {
            throw new SfException(ProblemFactory.badRequest(
                    "Project key must be URL-safe (lowercase letters, digits, hyphens, underscores)."));
        }
        return key;
    }

    private static String memberUuid(Long userId) {
        return "user-" + userId;
    }

    private com.fasterxml.jackson.databind.JsonNode memberDetail(Long userId, String role) {
        com.fasterxml.jackson.databind.node.ObjectNode node = objectMapper.createObjectNode();
        node.put("userId", userId);
        node.put("role", role);
        return node;
    }
}
