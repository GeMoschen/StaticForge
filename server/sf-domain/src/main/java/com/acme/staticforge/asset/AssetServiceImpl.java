package com.acme.staticforge.asset;

import com.acme.staticforge.asset.folder.FolderScope;
import com.acme.staticforge.asset.folder.PathService;
import com.acme.staticforge.asset.reference.ReferenceMaterializer;
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
import com.acme.staticforge.urlregistry.UrlRegistryRepository;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.NullNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.time.Instant;
import java.util.List;
import java.util.Map;
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
    private final UrlRegistryRepository urlRegistryRepository;
    private final ReferenceMaterializer referenceMaterializer;

    public AssetServiceImpl(
            AssetRepository assetRepository,
            AssetVersionRepository assetVersionRepository,
            AssetReferenceRepository assetReferenceRepository,
            AssetUidHistoryRepository assetUidHistoryRepository,
            UidGenerator uidGenerator,
            RevisionService revisionService,
            PathService pathService,
            UrlRegistryRepository urlRegistryRepository,
            ReferenceMaterializer referenceMaterializer) {
        this.assetRepository = assetRepository;
        this.assetVersionRepository = assetVersionRepository;
        this.assetReferenceRepository = assetReferenceRepository;
        this.assetUidHistoryRepository = assetUidHistoryRepository;
        this.uidGenerator = uidGenerator;
        this.revisionService = revisionService;
        this.pathService = pathService;
        this.urlRegistryRepository = urlRegistryRepository;
        this.referenceMaterializer = referenceMaterializer;
    }

    @Override
    @Transactional
    public AssetVersionView create(CreateAssetCommand cmd, RevisionContext ctx) {
        String displayName = validatedDisplayName(cmd.displayName());
        UUID uuid = UUID.randomUUID();
        String uid = uidGenerator.deriveUid(displayName, cmd.projectId(), cmd.type());

        validateFolderScope(cmd.projectId(), cmd.parentFolderUuid(), cmd.type());
        FolderScope scopeHint = cmd.type() == AssetType.FOLDER
                ? FolderScope.fromPayload(cmd.initialPayload())
                : FolderScope.requiredFor(cmd.type());
        FolderRef parent = resolveParent(cmd.parentFolderUuid(), cmd.projectId(), ctx, scopeHint);
        String folderPath;
        if (cmd.type() == AssetType.FOLDER) {
            folderPath = pathService.childPath(parent.path(), uid);
        } else {
            folderPath = pathService.contentPath(parent.path());
        }

        JsonNode payload = cmd.initialPayload() != null ? cmd.initialPayload() : JsonUtil.parse("{}");
        Long templateAssetId = cmd.templateUuid() == null
                ? null
                : assetRepository.findByProjectIdAndUuid(cmd.projectId(), cmd.templateUuid())
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
    public Map<AssetType, AssetVersionView> ensureTemplateFolders(long projectId, RevisionContext ctx) {
        AssetVersionView templatesRoot = ensureTemplatesRootFolder(projectId, ctx);
        Asset templatesRootAsset = assetRepository.findByProjectIdAndUuid(projectId, templatesRoot.uuid()).orElseThrow();
        return Map.of(
                AssetType.PAGE_TEMPLATE, ensureFixedFolder(
                        projectId, templatesRootAsset.getId(), templatesRoot.folderPath(),
                        FolderScope.PAGE_TEMPLATES_UID, "Page Templates",
                        FolderScope.TEMPLATES, AssetType.PAGE_TEMPLATE, ctx),
                AssetType.SECTION_TEMPLATE, ensureFixedFolder(
                        projectId, templatesRootAsset.getId(), templatesRoot.folderPath(),
                        FolderScope.SECTION_TEMPLATES_UID, "Section Templates",
                        FolderScope.TEMPLATES, AssetType.SECTION_TEMPLATE, ctx));
    }

    @Override
    @Transactional
    public AssetVersionView ensureNavigationRootFolder(long projectId, RevisionContext ctx) {
        AssetVersionView root = ensureRootFolder(projectId, ctx);
        Asset rootAsset = assetRepository.findByProjectIdAndUuid(projectId, root.uuid()).orElseThrow();
        return ensureFixedFolder(
                projectId, rootAsset.getId(), root.folderPath(),
                FolderScope.NAVIGATION_ROOT_UID, "All Navigation", FolderScope.NAVIGATION, null, ctx);
    }

    @Override
    @Transactional
    public AssetVersionView ensureTemplatesRootFolder(long projectId, RevisionContext ctx) {
        AssetVersionView root = ensureRootFolder(projectId, ctx);
        Asset rootAsset = assetRepository.findByProjectIdAndUuid(projectId, root.uuid()).orElseThrow();
        return ensureFixedFolder(
                projectId, rootAsset.getId(), root.folderPath(),
                FolderScope.TEMPLATES_ROOT_UID, "All Templates", FolderScope.TEMPLATES, null, ctx);
    }

    @Override
    @Transactional
    public AssetVersionView ensurePagesRootFolder(long projectId, RevisionContext ctx) {
        AssetVersionView root = ensureRootFolder(projectId, ctx);
        Asset rootAsset = assetRepository.findByProjectIdAndUuid(projectId, root.uuid()).orElseThrow();
        return ensureFixedFolder(
                projectId, rootAsset.getId(), root.folderPath(),
                FolderScope.PAGES_ROOT_UID, "All Pages", FolderScope.PAGES, null, ctx);
    }

    @Override
    @Transactional
    public AssetVersionView ensureMediaRootFolder(long projectId, RevisionContext ctx) {
        AssetVersionView root = ensureRootFolder(projectId, ctx);
        Asset rootAsset = assetRepository.findByProjectIdAndUuid(projectId, root.uuid()).orElseThrow();
        return ensureFixedFolder(
                projectId, rootAsset.getId(), root.folderPath(),
                FolderScope.MEDIA_ROOT_UID, "All Media", FolderScope.MEDIA, null, ctx);
    }

    @Override
    @Transactional
    public AssetVersionView ensureGlobalsRootFolder(long projectId, RevisionContext ctx) {
        AssetVersionView root = ensureRootFolder(projectId, ctx);
        Asset rootAsset = assetRepository.findByProjectIdAndUuid(projectId, root.uuid()).orElseThrow();
        return ensureFixedFolder(
                projectId, rootAsset.getId(), root.folderPath(),
                FolderScope.GLOBALS_ROOT_UID, "All Globals", FolderScope.GLOBALS, null, ctx);
    }

    /**
     * Finds-or-creates a fixed, protected root folder by its well-known uid under a given
     * parent, mirroring {@link #ensureRootFolder}'s exact lazy pattern. Deliberately bypasses
     * {@code FolderServiceImpl.create} — that path runs uid derivation instead of using this
     * fixed uid, and (for a top-level call) would hit the guards it enforces.
     */
    private AssetVersionView ensureFixedFolder(
            long projectId, Long parentAssetId, String parentPath, String uid, String displayName,
            FolderScope scope, AssetType templateKind, RevisionContext ctx) {
        Optional<Asset> existing = assetRepository.findByProjectIdAndAssetTypeAndUid(projectId, AssetType.FOLDER, uid);
        if (existing.isPresent()) {
            return toView(requireOpen(existing.get().getId()));
        }

        String folderPath = pathService.childPath(parentPath, uid);

        ObjectNode payload = (ObjectNode) JsonUtil.parse("{}");
        payload.put("scope", scope.name());
        if (templateKind != null) {
            payload.put("templateKind", templateKind.name());
        }
        payload.put("protected", true);

        return createInternal(
                projectId, AssetType.FOLDER, displayName, uid, UUID.randomUUID(),
                parentAssetId, folderPath, payload, null, ctx);
    }

    @Override
    @Transactional
    public AssetVersionView update(UUID uuid, UpdateAssetCommand cmd, long expectedRevision, RevisionContext ctx) {
        Asset asset = require(ctx.projectId(), uuid);
        AssetVersion current = requireOpen(asset.getId());

        Revision revision = revisionService.allocate(asset.getProjectId(), ChangeType.UPDATE, ctx.comment(), ctx.userId());
        checkExpectedRevision(current, expectedRevision);

        close(asset.getId(), revision.getRevisionId());
        AssetVersion next = insertVersion(
                asset,
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
        Asset asset = require(ctx.projectId(), uuid);

        if (!force && isReferencedByLiveAssets(asset)) {
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
                asset,
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

        // URL registry cascade-cleanup (feature url-registry, M8.2.1): a PageReference's
        // cached URLs (both PREVIEW and GENERATED areas, every channel) are unenforced-by-FK
        // value references keyed on this asset's uuid, so they cannot be cleaned up by
        // ON DELETE CASCADE — remove them explicitly here so a dangling registry row never
        // outlives the reference it was assigned to.
        if (asset.getAssetType() == AssetType.PAGE_REFERENCE) {
            urlRegistryRepository.deleteByPageReferenceUuid(asset.getUuid());
        }
    }

    @Override
    @Transactional
    public AssetVersionView restore(UUID uuid, long fromRevision, RevisionContext ctx) {
        Asset asset = require(ctx.projectId(), uuid);
        AssetVersion source = assetVersionRepository
                .findValidAtRevision(asset.getId(), fromRevision)
                .orElseThrow(() -> new SfException(ProblemFactory.notFound("No version valid at revision " + fromRevision + ".")));

        Revision revision = revisionService.allocate(asset.getProjectId(), ChangeType.RESTORE, ctx.comment(), ctx.userId());
        AssetVersion current = requireOpen(asset.getId());

        close(asset.getId(), revision.getRevisionId());
        AssetVersion next = insertVersion(
                asset,
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
    public Optional<AssetVersionView> findAt(long projectId, UUID uuid, long revision) {
        Asset asset = require(projectId, uuid);
        return assetVersionRepository.findValidAtRevision(asset.getId(), revision).map(this::toView);
    }

    @Override
    @Transactional(readOnly = true)
    public AssetVersionView requireCurrent(long projectId, UUID uuid) {
        Asset asset = require(projectId, uuid);
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
    public List<UsageView> usages(long projectId, UUID uuid) {
        Asset asset = require(projectId, uuid);
        return toUsages(assetReferenceRepository.findIncomingOpen(asset.getId()));
    }

    @Override
    @Transactional(readOnly = true)
    public List<UsageView> usagesAt(long projectId, UUID uuid, long revision) {
        Asset asset = require(projectId, uuid);
        return toUsages(assetReferenceRepository.findIncomingValidAt(asset.getId(), revision));
    }

    private List<UsageView> toUsages(List<AssetReference> refs) {
        Map<Long, Asset> fromAssets = new java.util.HashMap<>();
        assetRepository.findAllById(refs.stream().map(AssetReference::getFromAssetId).distinct().toList())
                .forEach(from -> fromAssets.put(from.getId(), from));
        return refs.stream()
                .filter(ref -> fromAssets.containsKey(ref.getFromAssetId()))
                .map(ref -> {
                    Asset from = fromAssets.get(ref.getFromAssetId());
                    return new UsageView(
                            from.getUuid(), from.getUid(), from.getAssetType(), ref.getKind(), ref.getSourcePath());
                })
                .toList();
    }

    @Override
    @Transactional(readOnly = true)
    public List<AssetVersionView> history(long projectId, UUID uuid) {
        Asset asset = require(projectId, uuid);
        return assetVersionRepository.findByAssetIdOrderByValidFromRevisionDesc(asset.getId()).stream()
                .map(this::toView)
                .toList();
    }

    @Override
    @Transactional
    public UidChangeResult changeUid(UUID uuid, String newUid, RevisionContext ctx) {
        Asset asset = require(ctx.projectId(), uuid);
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
     *
     * <p>A global property set has two spellings (M17.3.1) — the explicit {@code global:<uid>}
     * reference and the {@code CMS_GLOBAL.<uid>} accessor-root shorthand the parser desugars into
     * it — so both are matched; flagging only one would leave the other silently stale.
     */
    private List<UidLiteralReference> findUidLiteralReferences(long projectId, String oldUid) {
        Pattern pattern = Pattern.compile(
                "\\b(?:(?:page|media|section_template|page_template|folder|nav):|CMS_GLOBAL\\.)"
                        + Pattern.quote(oldUid) + "\\b");
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
        Asset asset = require(ctx.projectId(), uuid);
        if (asset.getAssetType() == AssetType.FOLDER) {
            throw new SfException(ProblemFactory.unprocessableEntity(
                    "Folder moves must use the folder move operation."));
        }

        validateFolderScope(asset.getProjectId(), newParentFolderUuid, asset.getAssetType());
        FolderRef parent = resolveParent(
                newParentFolderUuid, asset.getProjectId(), ctx, FolderScope.requiredFor(asset.getAssetType()));
        Revision revision = revisionService.allocate(asset.getProjectId(), ChangeType.MOVE, ctx.comment(), ctx.userId());
        AssetVersion current = requireOpen(asset.getId());

        close(asset.getId(), revision.getRevisionId());
        AssetVersion next = insertVersion(
                asset,
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

        Revision revision = revisionService.allocateOrJoin(ctx, ChangeType.CREATE);
        AssetVersion version = insertVersion(
                asset, revision.getRevisionId(), displayName, payload, ctx.userId(), Instant.now(),
                folderId, folderPath, templateAssetId, false);
        appendSummary(asset, revision, "CREATE", List.of());
        return toView(version);
    }

    /**
     * The delete guard (spec §5.4): only <em>open</em> incoming edges from another asset whose
     * current version is not deleted block deletion. Closed edges (a page that dropped the
     * reference) and self-references never do.
     */
    private boolean isReferencedByLiveAssets(Asset asset) {
        return assetReferenceRepository.findIncomingOpen(asset.getId()).stream()
                .map(AssetReference::getFromAssetId)
                .filter(fromAssetId -> !fromAssetId.equals(asset.getId()))
                .distinct()
                .anyMatch(fromAssetId -> assetVersionRepository.findByAssetIdAndValidToRevisionIsNull(fromAssetId)
                        .map(version -> !version.isDeleted())
                        .orElse(false));
    }

    private void close(Long assetId, long revisionId) {
        assetVersionRepository.findByAssetIdAndValidToRevisionIsNull(assetId).ifPresent(v -> {
            v.setValidToRevision(revisionId);
            assetVersionRepository.save(v);
        });
    }

    /** Inserts the new version and, in the same revision, syncs its outgoing reference rows (§5.4). */
    private AssetVersion insertVersion(
            Asset asset, long revisionId, String displayName, JsonNode payload, Long changedBy, Instant changedAt,
            Long folderId, String folderPath, Long templateAssetId, boolean deleted) {
        AssetVersion version = new AssetVersion(asset.getId(), revisionId, displayName, payload, changedBy, changedAt);
        version.setFolderId(folderId);
        version.setFolderPath(folderPath);
        version.setTemplateAssetId(templateAssetId);
        version.setDeleted(deleted);
        AssetVersion saved = assetVersionRepository.save(version);
        referenceMaterializer.materialize(asset, saved);
        return saved;
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
    private void validateFolderScope(long projectId, UUID parentFolderUuid, AssetType assetType) {
        FolderScope required = FolderScope.requiredFor(assetType);
        if (required == null || parentFolderUuid == null) {
            return;
        }
        Asset folder = assetRepository.findByProjectIdAndUuid(projectId, parentFolderUuid)
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

        // The TEMPLATES scope holds two disjoint subtrees under one FolderScope (spec M13.1.3) —
        // a PAGE_TEMPLATE and a SECTION_TEMPLATE folder are both `scope=TEMPLATES`, so the check
        // above alone can't tell them apart. This also covers a generic (non-folder-service) move
        // of a template asset, not just creation.
        if (required == FolderScope.TEMPLATES) {
            AssetType actualKind = FolderScope.templateKindFromPayload(version.getPayload());
            if (actualKind != null && actualKind != assetType) {
                throw new SfException(ProblemFactory.unprocessableEntity(
                        "This folder is for " + actualKind.name().toLowerCase()
                                + " assets — " + assetType.name().toLowerCase() + "s can't be placed here."));
            }
        }
    }

    /**
     * Resolves the parent folder to create/move an asset into. When {@code parentFolderUuid} is
     * {@code null} ("put this at the top"), {@code scopeHint} decides which fixed root that
     * means: {@code NAVIGATION}/{@code PAGES}/{@code MEDIA} each resolve into their own fixed,
     * protected wrapper root ({@link #ensureNavigationRootFolder}/{@link #ensurePagesRootFolder}/
     * {@link #ensureMediaRootFolder} — every top-level folder/loose leaf of that store nests
     * under it, so no asset of a scoped store ever sits directly under the project's shared
     * hidden root); anything else (an unscoped {@code FOLDER}) falls back to the shared hidden
     * root itself, unchanged. TEMPLATES leaf creation never reaches this branch at all — it's
     * pre-resolved by {@code TemplateServiceImpl} — so this is inert for Templates.
     */
    private FolderRef resolveParent(UUID parentFolderUuid, long projectId, RevisionContext ctx, FolderScope scopeHint) {
        if (parentFolderUuid == null) {
            AssetVersionView root;
            if (scopeHint == FolderScope.NAVIGATION) {
                root = ensureNavigationRootFolder(projectId, ctx);
            } else if (scopeHint == FolderScope.PAGES) {
                root = ensurePagesRootFolder(projectId, ctx);
            } else if (scopeHint == FolderScope.MEDIA) {
                root = ensureMediaRootFolder(projectId, ctx);
            } else if (scopeHint == FolderScope.GLOBALS) {
                root = ensureGlobalsRootFolder(projectId, ctx);
            } else {
                root = ensureRootFolder(projectId, ctx);
            }
            Asset rootAsset = assetRepository.findByProjectIdAndUuid(projectId, root.uuid()).orElseThrow();
            return new FolderRef(rootAsset.getId(), root.folderPath());
        }
        Asset folder = assetRepository.findByProjectIdAndUuid(projectId, parentFolderUuid)
                .orElseThrow(() -> new SfException(ProblemFactory.notFound("Parent folder not found.")));
        if (folder.getAssetType() != AssetType.FOLDER) {
            throw new SfException(ProblemFactory.unprocessableEntity("Parent is not a folder."));
        }
        AssetVersion version = requireOpen(folder.getId());
        return new FolderRef(folder.getId(), version.getFolderPath());
    }

    private Asset require(long projectId, UUID uuid) {
        return assetRepository.findByProjectIdAndUuid(projectId, uuid)
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
