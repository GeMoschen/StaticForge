package com.acme.staticforge.asset;

import com.acme.staticforge.asset.folder.FolderScope;
import com.acme.staticforge.asset.folder.PathService;
import com.acme.staticforge.asset.folder.RecordSetContainment;
import com.acme.staticforge.asset.media.BlobStore;
import com.acme.staticforge.asset.media.TextMediaCompiler;
import com.acme.staticforge.asset.media.TextMediaTypes;
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
import com.acme.staticforge.urlregistry.StartPageUrlInvalidation;
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
    private final BlobStore blobStore;
    private final StartPageUrlInvalidation startPageUrls;

    public AssetServiceImpl(
            AssetRepository assetRepository,
            AssetVersionRepository assetVersionRepository,
            AssetReferenceRepository assetReferenceRepository,
            AssetUidHistoryRepository assetUidHistoryRepository,
            UidGenerator uidGenerator,
            RevisionService revisionService,
            PathService pathService,
            UrlRegistryRepository urlRegistryRepository,
            ReferenceMaterializer referenceMaterializer,
            BlobStore blobStore,
            StartPageUrlInvalidation startPageUrls) {
        this.assetRepository = assetRepository;
        this.assetVersionRepository = assetVersionRepository;
        this.assetReferenceRepository = assetReferenceRepository;
        this.assetUidHistoryRepository = assetUidHistoryRepository;
        this.uidGenerator = uidGenerator;
        this.revisionService = revisionService;
        this.pathService = pathService;
        this.urlRegistryRepository = urlRegistryRepository;
        this.referenceMaterializer = referenceMaterializer;
        this.blobStore = blobStore;
        this.startPageUrls = startPageUrls;
    }

    @Override
    @Transactional
    public AssetVersionView create(CreateAssetCommand cmd, RevisionContext ctx) {
        String displayName = validatedDisplayName(cmd.displayName());
        UUID uuid = cmd.uuid() == null ? UUID.randomUUID() : cmd.uuid();
        String uid = cmd.uid() == null
                ? uidGenerator.deriveUid(displayName, cmd.projectId(), cmd.type())
                : requireAvailableUid(cmd.projectId(), cmd.type(), cmd.uid(), null);

        validateFolderScope(cmd.projectId(), cmd.parentFolderUuid(), cmd.type());
        requireContainment(cmd.projectId(), cmd.type(), cmd.initialPayload(), cmd.parentFolderUuid());
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
                        FolderScope.TEMPLATES, AssetType.SECTION_TEMPLATE, ctx),
                AssetType.DATASET, ensureFixedFolder(
                        projectId, templatesRootAsset.getId(), templatesRoot.folderPath(),
                        FolderScope.DATASETS_UID, "Datasets",
                        FolderScope.TEMPLATES, AssetType.DATASET, ctx));
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

    @Override
    @Transactional
    public AssetVersionView ensureContentRootFolder(long projectId, RevisionContext ctx) {
        AssetVersionView root = ensureRootFolder(projectId, ctx);
        Asset rootAsset = assetRepository.findByProjectIdAndUuid(projectId, root.uuid()).orElseThrow();
        return ensureFixedFolder(
                projectId, rootAsset.getId(), root.folderPath(),
                FolderScope.CONTENT_ROOT_UID, "All Content", FolderScope.CONTENT, null, ctx);
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

        // Joins an open batch (a dataset schema change migrating its records, M19.1.2), else allocates.
        Revision revision = revisionService.allocateOrJoin(ctx, ChangeType.UPDATE);
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
        startPageUrls.payloadChanged(asset, current.getPayload(), next.getPayload());
        return toView(next);
    }

    @Override
    @Transactional(readOnly = true)
    public void requireRevision(long projectId, UUID uuid, long expectedRevision) {
        checkExpectedRevision(requireOpen(require(projectId, uuid).getId()), expectedRevision);
    }

    @Override
    @Transactional
    public void softDelete(UUID uuid, boolean force, RevisionContext ctx) {
        Asset asset = require(ctx.projectId(), uuid);

        if (asset.getAssetType() == AssetType.DATASET) {
            // No cascade (M19.1.2, M25): records and record sets would be orphaned, so not even
            // `force` deletes a dataset that still has live records or live sets.
            long records = assetVersionRepository.countCurrentRecordsOfDataset(asset.getProjectId(), asset.getId());
            long sets = assetVersionRepository.countCurrentSetsOfDataset(asset.getProjectId(), asset.getId());
            if (records > 0 || sets > 0) {
                throw new SfException(Problem.builder()
                        .type("https://cms.example.com/problems/sf-dom-0121")
                        .title("Conflict")
                        .status(409)
                        .detail("Dataset still has " + count(records, "record") + " and " + count(sets, "record set")
                                + ". Delete them first.")
                        .property("code", "SF-DOM-0121")
                        .property("recordCount", records)
                        .property("setCount", sets)
                        .build());
            }
        }
        if (asset.getAssetType() == AssetType.RECORD_SET) {
            // Records never outlive their set (M25): the generic delete refuses a set with live records;
            // RecordSetService.delete(uuid, cascade=true) takes the set and its records in one revision.
            long records = assetVersionRepository.countCurrentChildrenOfType(asset.getId(), AssetType.RECORD);
            if (records > 0) {
                throw RecordSetContainment.notEmpty(records);
            }
        }
        if (!force && isReferencedByLiveAssets(asset)) {
            List<String> children = asset.getAssetType() == AssetType.PAGE_TEMPLATE ? liveChildTemplates(asset) : List.of();
            if (!children.isEmpty()) {
                throw new SfException(Problem.builder()
                        .type("https://cms.example.com/problems/sf-dom-0120")
                        .title("Conflict")
                        .status(409)
                        .detail("Page template is extended by " + String.join(", ", children)
                                + ". Change those templates to extend another one first.")
                        .property("code", "SF-DOM-0120")
                        .property("children", children)
                        .build());
            }
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

        // A restore puts the asset back into its old parent, so the containment rules hold there too (M25):
        // a record whose set is deleted stays deleted until the set is restored, which brings it back.
        String folderPath = source.getFolderPath();
        if (source.getFolderId() != null) {
            Asset parent = assetRepository.findById(source.getFolderId())
                    .orElseThrow(() -> new SfException(ProblemFactory.notFound("Parent folder not found.")));
            AssetVersion parentVersion = requireContainment(asset.getAssetType(), source.getPayload(), parent);
            if (parent.getAssetType() == AssetType.RECORD_SET) {
                // The set may have moved since: a record always sits at its set's folder path.
                folderPath = pathService.contentPath(parentVersion.getFolderPath());
            }
        }

        // Joins an open batch: a discard (M27.1.2) restores many released versions in one revision.
        Revision revision = revisionService.allocateOrJoin(ctx, ChangeType.RESTORE);
        AssetVersion current = requireOpen(asset.getId());
        Long deletedAt = asset.getAssetType() == AssetType.RECORD_SET && current.isDeleted()
                ? deletionRevision(asset.getId())
                : null;

        close(asset.getId(), revision.getRevisionId());
        AssetVersion next = insertVersion(
                asset,
                revision.getRevisionId(),
                source.getDisplayName(),
                source.getPayload(),
                ctx.userId(),
                Instant.now(),
                source.getFolderId(),
                folderPath,
                source.getTemplateAssetId(),
                false);
        appendSummary(asset, revision, "RESTORE", List.of("payload"));
        startPageUrls.payloadChanged(asset, current.isDeleted() ? null : current.getPayload(), next.getPayload());
        if (asset.getAssetType() == AssetType.RECORD_SET) {
            if (deletedAt != null) {
                restoreCascadeDeletedRecords(asset, deletedAt, next.getFolderPath(), revision, ctx);
            }
            rebaseRecords(asset, next.getFolderPath(), revision, ctx);
        }
        return toView(next);
    }

    /**
     * The revision that soft-deleted an asset whose current version is a tombstone: where its last live
     * version was closed, or {@code null} when it never was live.
     */
    private Long deletionRevision(Long assetId) {
        return assetVersionRepository.findByAssetIdOrderByValidFromRevisionDesc(assetId).stream()
                .filter(version -> !version.isDeleted())
                .findFirst()
                .map(AssetVersion::getValidToRevision)
                .orElse(null);
    }

    /**
     * Brings back the records a cascading set delete took with it (M25, folder cascade semantics): the
     * set's records whose live version was closed by the very revision that deleted the set and that are
     * still deleted. Records deleted on their own before stay deleted.
     */
    private void restoreCascadeDeletedRecords(
            Asset set, long deletedAt, String setFolderPath, Revision revision, RevisionContext ctx) {
        for (AssetVersion lastLive : assetVersionRepository.findLiveChildVersionsClosedAt(set.getId(), deletedAt)) {
            Asset record = lastLive.getAsset();
            if (record.getAssetType() != AssetType.RECORD) {
                continue;
            }
            AssetVersion current = requireOpen(record.getId());
            if (!current.isDeleted() || !set.getId().equals(current.getFolderId())) {
                continue;
            }
            close(record.getId(), revision.getRevisionId());
            insertVersion(
                    record,
                    revision.getRevisionId(),
                    current.getDisplayName(),
                    current.getPayload(),
                    ctx.userId(),
                    Instant.now(),
                    set.getId(),
                    pathService.contentPath(setFolderPath),
                    current.getTemplateAssetId(),
                    false);
            appendSummary(record, revision, "RESTORE", List.of());
        }
    }

    /**
     * Keeps a set's live records at the set's folder path (M25) once the set itself moved (a move, or a
     * restore into another folder), in the same revision — the way a folder move rebases its subtree.
     */
    private void rebaseRecords(Asset set, String setFolderPath, Revision revision, RevisionContext ctx) {
        String recordPath = pathService.contentPath(setFolderPath);
        for (AssetVersion current : assetVersionRepository.findByFolderIdAndValidToRevisionIsNullAndDeletedFalse(set.getId())) {
            if (recordPath.equals(current.getFolderPath())) {
                continue;
            }
            Asset record = assetRepository.findById(current.getAssetId()).orElseThrow();
            close(record.getId(), revision.getRevisionId());
            insertVersion(
                    record,
                    revision.getRevisionId(),
                    current.getDisplayName(),
                    current.getPayload(),
                    ctx.userId(),
                    Instant.now(),
                    set.getId(),
                    recordPath,
                    current.getTemplateAssetId(),
                    false);
            appendSummary(record, revision, "MOVE", List.of("folder"));
        }
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
        return toUsages(asset, assetReferenceRepository.findIncomingOpen(asset.getId()));
    }

    @Override
    @Transactional(readOnly = true)
    public List<UsageView> usagesAt(long projectId, UUID uuid, long revision) {
        Asset asset = require(projectId, uuid);
        return toUsages(asset, assetReferenceRepository.findIncomingValidAt(asset.getId(), revision));
    }

    /**
     * Incoming edges as usage rows. A dataset's own records ({@code TEMPLATE} edges from
     * {@code RECORD}s, M19.1.3) are left out: a dataset can have thousands, and its record count is
     * part of the dataset read model. What loops or reads it (templates) is listed as usual.
     */
    private List<UsageView> toUsages(Asset target, List<AssetReference> incoming) {
        List<AssetReference> refs = target.getAssetType() == AssetType.DATASET
                ? incoming.stream().filter(ref -> ref.getKind() != ReferenceKind.TEMPLATE).toList()
                : incoming;
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
        if (asset.getAssetType() == AssetType.RECORD) {
            throw new SfException(RecordNaming.derived());
        }
        String oldUid = asset.getUid();
        String uid = requireAvailableUid(asset.getProjectId(), asset.getAssetType(), newUid, asset.getId());

        Revision revision = revisionService.allocateOrJoin(ctx, ChangeType.UID_CHANGE);
        assetUidHistoryRepository.save(new AssetUidHistory(asset.getId(), oldUid, uid, revision.getRevisionId()));
        asset.setUid(uid);
        assetRepository.save(asset);
        appendSummary(asset, revision, "UID_CHANGE", List.of("uid"));

        return new UidChangeResult(oldUid, uid, findUidLiteralReferences(asset.getProjectId(), oldUid));
    }

    /**
     * Scans every current section/page template and dataset record template (M25.2.1) for the
     * literal {@code assetType:oldUid} reference form (§16.4) still present in the OCTL {@code source} after a UID change
     * ({@code dataset:}/{@code record:} included, M19.3.2; {@code recordset:}, M25).
     * Compiled templates already hold UUIDs; this is purely the source text the developer
     * should fix by hand.
     *
     * <p>A global property set has two spellings (M17.3.1) — the explicit {@code global:<uid>}
     * reference and the {@code CMS_GLOBAL.<uid>} accessor-root shorthand the parser desugars into
     * it — so both are matched; flagging only one would leave the other silently stale.
     *
     * <p>A processed text media file's source (its blob, M18.2.1) is OCTL too and is scanned the same
     * way; its entry carries the channel key {@code source}.
     */
    private List<UidLiteralReference> findUidLiteralReferences(long projectId, String oldUid) {
        Pattern pattern = Pattern.compile(
                "\\b(?:(?:page|media|section_template|page_template|folder|nav|global|dataset|record|recordset):|CMS_GLOBAL\\.)"
                        + Pattern.quote(oldUid) + "\\b");
        List<UidLiteralReference> found = new java.util.ArrayList<>();
        for (AssetType type : List.of(AssetType.SECTION_TEMPLATE, AssetType.PAGE_TEMPLATE, AssetType.DATASET)) {
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
        for (AssetVersion version : assetVersionRepository.findCurrentByProjectAndType(projectId, AssetType.MEDIA)) {
            JsonNode payload = version.getPayload();
            String sha = payload == null ? null : payload.path("blobSha256").asText(null);
            if (!TextMediaTypes.isProcessed(payload) || sha == null || !blobStore.exists(sha)) {
                continue;
            }
            if (pattern.matcher(TextMediaCompiler.decode(blobStore.get(sha)).text()).find()) {
                Asset from = version.getAsset();
                found.add(new UidLiteralReference(
                        from.getUuid(), from.getUid(), from.getAssetType(), version.getDisplayName(),
                        ReferenceMaterializer.MEDIA_SOURCE_PATH));
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
        AssetVersion current = requireOpen(asset.getId());
        requireContainment(asset.getProjectId(), asset.getAssetType(), current.getPayload(), newParentFolderUuid);
        FolderRef parent = resolveParent(
                newParentFolderUuid, asset.getProjectId(), ctx, FolderScope.requiredFor(asset.getAssetType()));
        Revision revision = revisionService.allocateOrJoin(ctx, ChangeType.MOVE);

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
        if (asset.getAssetType() == AssetType.RECORD_SET) {
            rebaseRecords(asset, next.getFolderPath(), revision, ctx);
        }
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
    /** The uids of the live page templates that extend {@code template} (M20): its open parent edges. */
    private List<String> liveChildTemplates(Asset template) {
        List<Long> childIds = assetReferenceRepository.findIncomingOpen(template.getId()).stream()
                .filter(ref -> ref.getKind() == ReferenceKind.TEMPLATE && "parentTemplateRef".equals(ref.getSourcePath()))
                .map(AssetReference::getFromAssetId)
                .distinct()
                .toList();
        return assetRepository.findAllById(childIds).stream()
                .filter(child -> assetVersionRepository.findByAssetIdAndValidToRevisionIsNull(child.getId())
                        .map(version -> !version.isDeleted())
                        .orElse(false))
                .map(Asset::getUid)
                .sorted()
                .toList();
    }

    private boolean isReferencedByLiveAssets(Asset asset) {
        return assetReferenceRepository.findIncomingOpen(asset.getId()).stream()
                // A folder's start page may go: the folder falls back to the indexUid rule (M31).
                .filter(ref -> ref.getKind() != ReferenceKind.START_PAGE)
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
        version.projectMediaColumns(asset.getAssetType());
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
            } else if (scopeHint == FolderScope.CONTENT) {
                root = ensureContentRootFolder(projectId, ctx);
            } else {
                root = ensureRootFolder(projectId, ctx);
            }
            Asset rootAsset = assetRepository.findByProjectIdAndUuid(projectId, root.uuid()).orElseThrow();
            return new FolderRef(rootAsset.getId(), root.folderPath());
        }
        Asset folder = assetRepository.findByProjectIdAndUuid(projectId, parentFolderUuid)
                .orElseThrow(() -> new SfException(ProblemFactory.notFound("Parent folder not found.")));
        // A record set is the one non-folder parent (M25); requireContainment admits only records into it.
        if (folder.getAssetType() != AssetType.FOLDER && folder.getAssetType() != AssetType.RECORD_SET) {
            throw new SfException(ProblemFactory.unprocessableEntity("Parent is not a folder."));
        }
        AssetVersion version = requireOpen(folder.getId());
        return new FolderRef(folder.getId(), version.getFolderPath());
    }

    /**
     * Enforces the record set containment rules (M25, {@link RecordSetContainment}) for placing an asset
     * of {@code type} with {@code payload} under {@code parentUuid} ({@code null}: its store's root folder).
     */
    private void requireContainment(long projectId, AssetType type, JsonNode payload, UUID parentUuid) {
        if (parentUuid == null) {
            RecordSetContainment.require(type, payload, AssetType.FOLDER, null, false);
            return;
        }
        Asset parent = assetRepository.findByProjectIdAndUuid(projectId, parentUuid)
                .orElseThrow(() -> new SfException(ProblemFactory.notFound("Parent folder not found.")));
        requireContainment(type, payload, parent);
    }

    /** {@link #requireContainment(long, AssetType, JsonNode, UUID)} for a resolved parent; returns its current version. */
    private AssetVersion requireContainment(AssetType type, JsonNode payload, Asset parent) {
        AssetVersion version = requireOpen(parent.getId());
        RecordSetContainment.require(type, payload, parent.getAssetType(), version.getPayload(), version.isDeleted());
        return version;
    }

    private static String count(long n, String noun) {
        return n + " " + noun + (n == 1 ? "" : "s");
    }

    /**
     * A well-formed, unreserved uid no other asset of {@code type} holds ({@code self} may hold it
     * already), else {@code 422}: malformed ({@code SF-API-0422}), reserved ({@code SF-DOM-0102}) or
     * taken ({@code SF-DOM-0101}).
     */
    private String requireAvailableUid(long projectId, AssetType type, String candidate, Long self) {
        String uid = validatedUid(candidate);
        if (uidGenerator.isReserved(uid)) {
            throw new SfException(ProblemFactory.other(422, "SF-DOM-0102", "Validation Failed", "UID is reserved."));
        }
        assetRepository.findByProjectIdAndAssetTypeAndUid(projectId, type, uid).ifPresent(existing -> {
            if (!existing.getId().equals(self)) {
                throw new SfException(ProblemFactory.other(422, "SF-DOM-0101", "Validation Failed", "UID already taken."));
            }
        });
        return uid;
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
