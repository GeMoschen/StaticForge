package com.acme.staticforge.project;

import com.acme.staticforge.asset.AssetService;
import com.acme.staticforge.audit.AuditService;
import com.acme.staticforge.channel.ChannelService;
import com.acme.staticforge.common.ProblemFactory;
import com.acme.staticforge.common.SfException;
import com.acme.staticforge.revision.AssetChange;
import com.acme.staticforge.revision.ChangeType;
import com.acme.staticforge.revision.Revision;
import com.acme.staticforge.revision.RevisionAware;
import com.acme.staticforge.revision.RevisionContext;
import com.acme.staticforge.revision.RevisionCounterRepository;
import com.acme.staticforge.revision.RevisionService;
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

    public ProjectServiceImpl(
            ProjectRepository projectRepository,
            ProjectMemberRepository projectMemberRepository,
            RevisionService revisionService,
            RevisionCounterRepository counterRepository,
            ChannelService channelService,
            AuditService auditService,
            ObjectMapper objectMapper,
            AssetService assetService) {
        this.projectRepository = projectRepository;
        this.projectMemberRepository = projectMemberRepository;
        this.revisionService = revisionService;
        this.counterRepository = counterRepository;
        this.channelService = channelService;
        this.auditService = auditService;
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
        revisionService.allocate(project.getId(), ChangeType.CREATE, cmd.comment(), actingUserId);

        ProjectMember member = new ProjectMember(project.getId(), actingUserId, ProjectRole.PROJECT_ADMIN, Instant.now());
        member.setGrantedBy(actingUserId);
        projectMemberRepository.save(member);

        channelService.ensureDefaultChannels(project.getId(), actingUserId);

        RevisionContext creationCtx = RevisionContext.of(project.getId(), actingUserId, cmd.comment());

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
    public List<Project> listAll() {
        return projectRepository.findAll(Sort.by(Sort.Direction.ASC, "key"));
    }

    @Override
    @Transactional
    public Project update(String key, String name, String description, List<String> allowedMimeTypes, Long actingUserId, String comment) {
        Project project = requireByKey(key);
        project.setName(name);
        project.setDescription(description);
        project.setAllowedMimeTypes(joinMimeTypes(allowedMimeTypes));
        projectRepository.save(project);
        revisionService.allocate(project.getId(), ChangeType.UPDATE, comment, actingUserId);
        return project;
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
    public void archive(String key, Long actingUserId, String comment) {
        Project project = requireByKey(key);
        project.setArchived(true);
        projectRepository.save(project);
        revisionService.allocate(project.getId(), ChangeType.UPDATE, comment, actingUserId);
    }

    @Override
    @Transactional(readOnly = true)
    public List<ProjectMember> members(String key) {
        Project project = requireByKey(key);
        return projectMemberRepository.findByProjectIdOrderByUserIdAsc(project.getId());
    }

    @Override
    @Transactional
    public void setMemberRole(String key, Long userId, ProjectRole role, Long actingUserId, String comment) {
        Project project = requireByKey(key);

        ProjectMember member = projectMemberRepository
                .findByProjectIdAndUserId(project.getId(), userId)
                .orElseGet(() -> new ProjectMember(project.getId(), userId, role, Instant.now()));
        member.setRole(role);
        member.setGrantedBy(actingUserId);
        projectMemberRepository.save(member);

        Revision revision = revisionService.allocate(project.getId(), ChangeType.UPDATE, comment, actingUserId);
        revisionService.appendSummary(
                project.getId(),
                revision.getRevisionId(),
                AssetChange.create(memberUuid(userId), MEMBER_ASSET_TYPE, "UPDATE", List.of("role")));

        auditService.record(
                project.getId(), actingUserId, "MEMBER_ROLE_SET", "member:" + userId, memberDetail(userId, role.name()));
    }

    @Override
    @Transactional
    public void removeMember(String key, Long userId, Long actingUserId, String comment) {
        Project project = requireByKey(key);
        projectMemberRepository.deleteByProjectIdAndUserId(project.getId(), userId);

        Revision revision = revisionService.allocate(project.getId(), ChangeType.UPDATE, comment, actingUserId);
        revisionService.appendSummary(
                project.getId(),
                revision.getRevisionId(),
                AssetChange.create(memberUuid(userId), MEMBER_ASSET_TYPE, "DELETE", List.of()));

        auditService.record(project.getId(), actingUserId, "MEMBER_REMOVED", "member:" + userId, memberDetail(userId, null));
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
