package com.acme.staticforge.asset;

import com.acme.staticforge.asset.folder.FolderScope;
import com.acme.staticforge.asset.folder.PathService;
import com.acme.staticforge.common.JsonUtil;
import com.acme.staticforge.common.Problem;
import com.acme.staticforge.common.ProblemFactory;
import com.acme.staticforge.common.SfException;
import com.acme.staticforge.revision.AssetChange;
import com.acme.staticforge.revision.ChangeType;
import com.acme.staticforge.revision.Revision;
import com.acme.staticforge.revision.RevisionAware;
import com.acme.staticforge.revision.RevisionContext;
import com.acme.staticforge.revision.RevisionService;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.NullNode;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import java.util.regex.Pattern;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * {@link AssetService} implementation. Owns the version-interval write algorithm (§7.4) and
 * the optimistic-concurrency protocol (§7.5). Every mutation allocates a revision, closes the
 * current version and inserts a new one; deletion is a {@code deleted=true} row, never a
 * physical remove.
 */
@Service
@RevisionAware
public class AssetServiceImpl implements AssetService {

    private static final Pattern UID_PATTERN = Pattern.compile("[a-z0-9]+(_[a-z0-9]+)*");

    private final AssetRepository assetRepository;
    private final AssetVersionRepository assetVersionRepository;
    private final AssetReferenceRepository assetReferenceRepository;
    private final AssetUidHistoryRepository assetUidHistoryRepository;
    private final UidGenerator uidGenerator;
    private final RevisionService revisionService;
    private final PathService pathService;

    public AssetServiceImpl(
            AssetRepository assetRepository,
            AssetVersionRepository assetVersionRepository,
            AssetReferenceRepository assetReferenceRepository,
            AssetUidHistoryRepository assetUidHistoryRepository,
            UidGenerator uidGenerator,
            RevisionService revisionService,
            PathService pathService) {
        this.assetRepository = assetRepository;
        this.assetVersionRepository = assetVersionRepository;
        this.assetReferenceRepository = assetReferenceRepository;
        this.assetUidHistoryRepository = assetUidHistoryRepository;
        this.uidGenerator = uidGenerator;
        this.revisionService = revisionService;
        this.pathService = pathService;
    }

    @Override
    @Transactional
    public AssetVersionView create(CreateAssetCommand cmd, RevisionContext ctx) {
        String displayName = validatedDisplayName(cmd.displayName());
        UUID uuid = UUID.randomUUID();
        String uid = uidGenerator.deriveUid(displayName, cmd.projectId(), cmd.type());

        validateFolderScope(cmd.parentFolderUuid(), cmd.type());
        FolderRef parent = resolveParent(cmd.parentFolderUuid(), cmd.projectId(), ctx);
        String folderPath;
        if (cmd.type() == AssetType.FOLDER) {
            folderPath = pathService.childPath(parent.path(), uid);
        } else {
            folderPath = pathService.contentPath(parent.path());
        }

        JsonNode payload = cmd.initialPayload() != null ? cmd.initialPayload() : JsonUtil.parse("{}");
        Long templateAssetId = cmd.templateUuid() == null
                ? null
                : assetRepository.findByUuid(cmd.templateUuid())
                        .map(Asset::getId)
                        .orElseThrow(() -> new SfException(ProblemFactory.notFound("Template not found.")));
        return createInternal(cmd.projectId(), cmd.type(), displayName, uid, uuid, parent.id(), folderPath, payload, templateAssetId, ctx);
    }

    @Override
    @Transactional
    public AssetVersionView ensureRootFolder(long projectId, RevisionContext ctx) {
        Optional<Asset> existing = assetRepository.findByProjectIdAndAssetTypeAndUid(projectId, AssetType.FOLDER, PathService.ROOT_UID);
        if (existing.isPresent()) {
            return toView(requireOpen(existing.get().getId()));
        }
        return createInternal(
                projectId,
                AssetType.FOLDER,
                "Root",
                PathService.ROOT_UID,
                UUID.randomUUID(),
                null,
                PathService.ROOT_PATH,
                JsonUtil.parse("{}"),
                null,
                ctx);
    }

    @Override
    @Transactional
    public AssetVersionView update(UUID uuid, UpdateAssetCommand cmd, long expectedRevision, RevisionContext ctx) {
        Asset asset = require(uuid);
        AssetVersion current = requireOpen(asset.getId());

        Revision revision = revisionService.allocate(asset.getProjectId(), ChangeType.UPDATE, ctx.comment(), ctx.userId());
        checkExpectedRevision(current, expectedRevision);

        close(asset.getId(), revision.getRevisionId());
        AssetVersion next = insertVersion(
                asset.getId(),
                revision.getRevisionId(),
                validatedDisplayName(cmd.displayName()),
                cmd.payload(),
                ctx.userId(),
                Instant.now(),
                current.getFolderId(),
                current.getFolderPath(),
                current.getTemplateAssetId(),
                current.isDeleted());
        appendSummary(asset, revision, "UPDATE", List.of("payload"));
        return toView(next);
    }

    @Override
    @Transactional
    public void softDelete(UUID uuid, boolean force, RevisionContext ctx) {
        Asset asset = require(uuid);

        if (!force && !assetReferenceRepository.findByToAssetId(asset.getId()).isEmpty()) {
            throw new SfException(ProblemFactory.other(
                    409, "SF-DOM-0120", "Conflict", "Asset is still referenced by other assets."));
        }

        Revision revision = revisionService.allocate(asset.getProjectId(), ChangeType.DELETE, ctx.comment(), ctx.userId());
        AssetVersion current = requireOpen(asset.getId());

        if (current.isDeleted()) {
            return;
        }

        close(asset.getId(), revision.getRevisionId());
        AssetVersion next = insertVersion(
                asset.getId(),
                revision.getRevisionId(),
                current.getDisplayName(),
                current.getPayload(),
                ctx.userId(),
                Instant.now(),
                current.getFolderId(),
                current.getFolderPath(),
                current.getTemplateAssetId(),
                true);
        appendSummary(asset, revision, "DELETE", List.of());
    }

    @Override
    @Transactional
    public AssetVersionView restore(UUID uuid, long fromRevision, RevisionContext ctx) {
        Asset asset = require(uuid);
        AssetVersion source = assetVersionRepository
                .findValidAtRevision(asset.getId(), fromRevision)
                .orElseThrow(() -> new SfException(ProblemFactory.notFound("No version valid at revision " + fromRevision + ".")));

        Revision revision = revisionService.allocate(asset.getProjectId(), ChangeType.RESTORE, ctx.comment(), ctx.userId());
        AssetVersion current = requireOpen(asset.getId());

        close(asset.getId(), revision.getRevisionId());
        AssetVersion next = insertVersion(
                asset.getId(),
                revision.getRevisionId(),
                source.getDisplayName(),
                source.getPayload(),
                ctx.userId(),
                Instant.now(),
                source.getFolderId(),
                source.getFolderPath(),
                source.getTemplateAssetId(),
                false);
        appendSummary(asset, revision, "RESTORE", List.of("payload"));
        return toView(next);
    }

    @Override
    @Transactional(readOnly = true)
    public Optional<AssetVersionView> findAt(UUID uuid, long revision) {
        Asset asset = require(uuid);
        return assetVersionRepository.findValidAtRevision(asset.getId(), revision).map(this::toView);
    }

    @Override
    @Transactional(readOnly = true)
    public AssetVersionView requireCurrent(UUID uuid) {
        Asset asset = require(uuid);
        return toView(requireOpen(asset.getId()));
    }

    @Override
    @Transactional(readOnly = true)
    public Page<AssetSummary> search(AssetQuery query, Pageable pageable) {
        return assetVersionRepository
                .search(
                        query.projectId(),
                        query.type(),
                        escapeLike(trimToNull(query.q())),
                        folderPattern(query.folder()),
                        pageable)
                .map(v -> new AssetSummary(
                        v.getAsset().getUuid(),
                        v.getAsset().getUid(),
                        v.getAsset().getAssetType(),
                        v.getDisplayName(),
                        v.getFolderPath(),
                        v.getValidFromRevision()));
    }

    @Override
    @Transactional(readOnly = true)
    public List<UsageView> usages(UUID uuid) {
        Asset asset = require(uuid);
        return assetReferenceRepository.findByToAssetId(asset.getId()).stream()
                .filter(ref -> ref.getValidToRevision() == null)
                .map(ref -> {
                    Asset from = assetRepository.findById(ref.getFromAssetId()).orElse(null);
                    if (from == null) {
                        return null;
                    }
                    return new UsageView(
                            from.getUuid(), from.getUid(), from.getAssetType(), ref.getKind(), ref.getSourcePath());
                })
                .filter(java.util.Objects::nonNull)
                .toList();
    }

    @Override
    @Transactional(readOnly = true)
    public List<AssetVersionView> history(UUID uuid) {
        Asset asset = require(uuid);
        return assetVersionRepository.findByAssetIdOrderByValidFromRevisionDesc(asset.getId()).stream()
                .map(this::toView)
                .toList();
    }

    @Override
    @Transactional
    public UidChangeResult changeUid(UUID uuid, String newUid, RevisionContext ctx) {
        Asset asset = require(uuid);
        String oldUid = asset.getUid();
        String uid = validatedUid(newUid);

        if (uidGenerator.isReserved(uid)) {
            throw new SfException(ProblemFactory.other(422, "SF-DOM-0102", "Validation Failed", "UID is reserved."));
        }
        assetRepository.findByProjectIdAndAssetTypeAndUid(asset.getProjectId(), asset.getAssetType(), uid).ifPresent(existing -> {
            if (!existing.getId().equals(asset.getId())) {
                throw new SfException(ProblemFactory.other(422, "SF-DOM-0101", "Validation Failed", "UID already taken."));
            }
        });

        Revision revision = revisionService.allocate(asset.getProjectId(), ChangeType.UID_CHANGE, ctx.comment(), ctx.userId());
        assetUidHistoryRepository.save(new AssetUidHistory(asset.getId(), oldUid, uid, revision.getRevisionId()));
        asset.setUid(uid);
        assetRepository.save(asset);
        appendSummary(asset, revision, "UID_CHANGE", List.of("uid"));

        return new UidChangeResult(oldUid, uid, findUidLiteralReferences(asset.getProjectId(), oldUid));
    }

    /**
     * Scans every current section/page template for the literal {@code assetType:oldUid}
     * reference form (§16.4) still present in the OCTL {@code source} after a UID change.
     * Compiled templates already hold UUIDs; this is purely the source text the developer
     * should fix by hand.
     */
    private List<UidLiteralReference> findUidLiteralReferences(long projectId, String oldUid) {
        Pattern pattern = Pattern.compile(
                "\\b(?:page|media|section_template|page_template|folder):" + Pattern.quote(oldUid) + "\\b");
        List<UidLiteralReference> found = new java.util.ArrayList<>();
        for (AssetType type : List.of(AssetType.SECTION_TEMPLATE, AssetType.PAGE_TEMPLATE)) {
            for (AssetVersion version : assetVersionRepository.findCurrentByProjectAndType(projectId, type)) {
                JsonNode payload = version.getPayload();
                JsonNode channelTemplates = payload == null ? null : payload.get("channelTemplates");
                if (channelTemplates == null || !channelTemplates.isObject()) {
                    continue;
                }
                channelTemplates.fields().forEachRemaining(entry -> {
                    JsonNode channel = entry.getValue();
                    String source = channel != null && channel.has("source") && channel.get("source").isTextual()
                            ? channel.get("source").asText()
                            : "";
                    if (!source.isEmpty() && pattern.matcher(source).find()) {
                        Asset from = version.getAsset();
                        found.add(new UidLiteralReference(
                                from.getUuid(), from.getUid(), from.getAssetType(), version.getDisplayName(), entry.getKey()));
                    }
                });
            }
        }
        return found;
    }

    @Override
    @Transactional
    public AssetVersionView move(UUID uuid, UUID newParentFolderUuid, RevisionContext ctx) {
        Asset asset = require(uuid);
        if (asset.getAssetType() == AssetType.FOLDER) {
            throw new SfException(ProblemFactory.unprocessableEntity(
                    "Folder moves must use the folder move operation."));
        }

        validateFolderScope(newParentFolderUuid, asset.getAssetType());
        FolderRef parent = resolveParent(newParentFolderUuid, asset.getProjectId(), ctx);
        Revision revision = revisionService.allocate(asset.getProjectId(), ChangeType.MOVE, ctx.comment(), ctx.userId());
        AssetVersion current = requireOpen(asset.getId());

        close(asset.getId(), revision.getRevisionId());
        AssetVersion next = insertVersion(
                asset.getId(),
                revision.getRevisionId(),
                current.getDisplayName(),
                current.getPayload(),
                ctx.userId(),
                Instant.now(),
                parent.id(),
                pathService.contentPath(parent.path()),
                current.getTemplateAssetId(),
                current.isDeleted());
        appendSummary(asset, revision, "MOVE", List.of("folder"));
        return toView(next);
    }

    private AssetVersionView createInternal(
            long projectId, AssetType type, String displayName, String uid, UUID uuid, Long folderId,
            String folderPath, JsonNode payload, Long templateAssetId, RevisionContext ctx) {
        Asset asset = new Asset(uuid, projectId, type, uid, Instant.now(), ctx.userId());
        asset = assetRepository.save(asset);

        Revision revision = revisionService.allocate(projectId, ChangeType.CREATE, ctx.comment(), ctx.userId());
        AssetVersion version = insertVersion(
                asset.getId(), revision.getRevisionId(), displayName, payload, ctx.userId(), Instant.now(),
                folderId, folderPath, templateAssetId, false);
        appendSummary(asset, revision, "CREATE", List.of());
        return toView(version);
    }

    private void close(Long assetId, long revisionId) {
        assetVersionRepository.findByAssetIdAndValidToRevisionIsNull(assetId).ifPresent(v -> {
            v.setValidToRevision(revisionId);
            assetVersionRepository.save(v);
        });
    }

    private AssetVersion insertVersion(
            Long assetId, long revisionId, String displayName, JsonNode payload, Long changedBy, Instant changedAt,
            Long folderId, String folderPath, Long templateAssetId, boolean deleted) {
        AssetVersion version = new AssetVersion(assetId, revisionId, displayName, payload, changedBy, changedAt);
        version.setFolderId(folderId);
        version.setFolderPath(folderPath);
        version.setTemplateAssetId(templateAssetId);
        version.setDeleted(deleted);
        return assetVersionRepository.save(version);
    }

    private void appendSummary(Asset asset, Revision revision, String action, List<String> fields) {
        revisionService.appendSummary(
                asset.getProjectId(),
                revision.getRevisionId(),
                AssetChange.create(asset.getUuid().toString(), asset.getAssetType().name(), action, fields));
    }

    private void checkExpectedRevision(AssetVersion current, long expectedRevision) {
        if (current.getValidFromRevision() != expectedRevision) {
            JsonNode base = assetVersionRepository
                    .findValidAtRevision(current.getAssetId(), expectedRevision)
                    .map(AssetVersion::getPayload)
                    .orElse(null);
            JsonNode theirs = current.getPayload();
            Problem problem = Problem.builder()
                    .type("https://cms.example.com/problems/sf-api-0409")
                    .title("The asset changed since you loaded it")
                    .status(409)
                    .detail("Expected revision " + expectedRevision + ", current revision is "
                            + current.getValidFromRevision() + ".")
                    .property("code", "SF-API-0409")
                    .property("expectedRevision", expectedRevision)
                    .property("currentRevision", current.getValidFromRevision())
                    .property("changedBy", current.getChangedBy())
                    .property("changedAt", current.getChangedAt().toString())
                    .property("base", base != null ? base : NullNode.getInstance())
                    .property("theirs", theirs != null ? theirs : NullNode.getInstance())
                    .build();
            throw new SfException(problem);
        }
    }

    /**
     * Pages and media each live in their own separate folder tree (§10.2 scope split). When an
     * explicit target folder is given, it must belong to the store the asset type requires;
     * the implicit root (parentFolderUuid == null) and legacy/scope-less folders are permissive.
     */
    private void validateFolderScope(UUID parentFolderUuid, AssetType assetType) {
        FolderScope required = FolderScope.requiredFor(assetType);
        if (required == null || parentFolderUuid == null) {
            return;
        }
        Asset folder = assetRepository.findByUuid(parentFolderUuid)
                .orElseThrow(() -> new SfException(ProblemFactory.notFound("Parent folder not found.")));
        if (folder.getAssetType() != AssetType.FOLDER) {
            return;
        }
        AssetVersion version = requireOpen(folder.getId());
        FolderScope actual = FolderScope.fromPayload(version.getPayload());
        if (actual != null && actual != required) {
            throw new SfException(ProblemFactory.unprocessableEntity(
                    "This folder belongs to the " + actual.name().toLowerCase()
                            + " store — " + assetType.name().toLowerCase() + " assets can't be placed here."));
        }
    }

    private FolderRef resolveParent(UUID parentFolderUuid, long projectId, RevisionContext ctx) {
        if (parentFolderUuid == null) {
            AssetVersionView root = ensureRootFolder(projectId, ctx);
            Asset rootAsset = assetRepository.findByUuid(root.uuid()).orElseThrow();
            return new FolderRef(rootAsset.getId(), PathService.ROOT_PATH);
        }
        Asset folder = assetRepository.findByUuid(parentFolderUuid)
                .orElseThrow(() -> new SfException(ProblemFactory.notFound("Parent folder not found.")));
        if (folder.getAssetType() != AssetType.FOLDER) {
            throw new SfException(ProblemFactory.unprocessableEntity("Parent is not a folder."));
        }
        AssetVersion version = requireOpen(folder.getId());
        return new FolderRef(folder.getId(), version.getFolderPath());
    }

    private Asset require(UUID uuid) {
        return assetRepository.findByUuid(uuid)
                .orElseThrow(() -> new SfException(ProblemFactory.notFound("Asset not found.")));
    }

    private AssetVersion requireOpen(Long assetId) {
        return assetVersionRepository.findByAssetIdAndValidToRevisionIsNull(assetId)
                .orElseThrow(() -> new SfException(ProblemFactory.notFound("Asset has no current version.")));
    }

    private AssetVersionView toView(AssetVersion version) {
        Asset asset = version.getAsset() != null ? version.getAsset() : assetRepository.findById(version.getAssetId()).orElse(null);
        if (asset == null) {
            throw new SfException(ProblemFactory.notFound("Asset not found."));
        }
        return new AssetVersionView(
                asset.getUuid(),
                asset.getUid(),
                asset.getAssetType(),
                version.getDisplayName(),
                version.getPayload(),
                version.getValidFromRevision(),
                version.isDeleted(),
                version.getFolderId(),
                version.getFolderPath(),
                version.getTemplateAssetId(),
                version.getChangedBy(),
                version.getChangedAt());
    }

    private static String validatedDisplayName(String displayName) {
        if (displayName == null || displayName.isBlank()) {
            throw new SfException(ProblemFactory.badRequest("displayName must not be blank."));
        }
        String trimmed = displayName.trim();
        if (trimmed.length() > 200) {
            throw new SfException(ProblemFactory.badRequest("displayName must be at most 200 characters."));
        }
        return trimmed;
    }

    private static String validatedUid(String uid) {
        if (uid == null || uid.isBlank()) {
            throw new SfException(ProblemFactory.unprocessableEntity("UID must not be blank."));
        }
        if (uid.length() > 120) {
            throw new SfException(ProblemFactory.unprocessableEntity("UID must be at most 120 characters."));
        }
        if (!UID_PATTERN.matcher(uid).matches()) {
            throw new SfException(ProblemFactory.unprocessableEntity(
                    "UID must be lowercase letters, digits and single underscores."));
        }
        return uid;
    }

    private static String trimToNull(String value) {
        return (value == null || value.isBlank()) ? null : value.trim();
    }

    private static String folderPattern(String folder) {
        String trimmed = trimToNull(folder);
        if (trimmed == null) {
            return null;
        }
        return escapeLike(trimmed) + "%";
    }

    private static String escapeLike(String value) {
        if (value == null) {
            return null;
        }
        return value.replace("!", "!!").replace("%", "!%").replace("_", "!_");
    }

    private record FolderRef(Long id, String path) {}
}
