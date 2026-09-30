package com.acme.staticforge.asset.navigation;

import com.acme.staticforge.asset.Asset;
import com.acme.staticforge.asset.AssetRepository;
import com.acme.staticforge.asset.AssetService;
import com.acme.staticforge.asset.AssetType;
import com.acme.staticforge.asset.AssetVersion;
import com.acme.staticforge.asset.AssetVersionRepository;
import com.acme.staticforge.asset.AssetVersionView;
import com.acme.staticforge.asset.CreateAssetCommand;
import com.acme.staticforge.asset.UpdateAssetCommand;
import com.acme.staticforge.asset.folder.FolderScope;
import com.acme.staticforge.common.JsonUtil;
import com.acme.staticforge.common.ProblemFactory;
import com.acme.staticforge.common.SfException;
import com.acme.staticforge.revision.RevisionAware;
import com.acme.staticforge.revision.RevisionContext;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * {@link PageReferenceService} implementation. Structural validation resolves {@code target}
 * to a live {@code Page} or a live {@code FolderScope.PAGES} folder — there is no CDL here,
 * so this is the entirety of the validation a {@code PAGE_REFERENCE} payload needs (spec §17,
 * `M8.1.2`).
 */
@Service
@RevisionAware
public class PageReferenceServiceImpl implements PageReferenceService {

    private final AssetRepository assetRepository;
    private final AssetVersionRepository assetVersionRepository;
    private final AssetService assetService;
    private final NavigationService navigationService;
    private final NavigationLookup navigationLookup;
    private final com.acme.staticforge.project.ProjectLocales projectLocales;

    public PageReferenceServiceImpl(
            AssetRepository assetRepository,
            AssetVersionRepository assetVersionRepository,
            AssetService assetService,
            NavigationService navigationService,
            LiveNavigationLookup navigationLookup,
            com.acme.staticforge.project.ProjectLocales projectLocales) {
        this.assetRepository = assetRepository;
        this.assetVersionRepository = assetVersionRepository;
        this.assetService = assetService;
        this.navigationService = navigationService;
        this.navigationLookup = navigationLookup;
        this.projectLocales = projectLocales;
    }

    @Override
    @Transactional
    public AssetVersionView create(CreatePageReferenceCommand cmd, RevisionContext ctx) {
        requireValidTarget(ctx.projectId(), cmd.targetKind(), cmd.targetAssetUuid());

        ObjectNode payload = JsonUtil.object(null);
        writeTarget(payload, cmd.targetKind(), cmd.targetAssetUuid());
        writeLabel(payload, cmd.label());

        return assetService.create(
                new CreateAssetCommand(
                        ctx.projectId(), AssetType.PAGE_REFERENCE, cmd.displayName(), cmd.folderUuid(), payload, null),
                ctx);
    }

    @Override
    @Transactional
    public AssetVersionView update(
            UUID uuid,
            PageReferenceTargetKind targetKind,
            UUID targetAssetUuid,
            String label,
            long expectedRevision,
            RevisionContext ctx) {
        return update(uuid, targetKind, targetAssetUuid, label, null, expectedRevision, ctx);
    }

    @Override
    @Transactional
    public AssetVersionView update(
            UUID uuid,
            PageReferenceTargetKind targetKind,
            UUID targetAssetUuid,
            String label,
            String locale,
            long expectedRevision,
            RevisionContext ctx) {
        requireValidTarget(ctx.projectId(), targetKind, targetAssetUuid);

        Asset pageReference = requirePageReference(ctx.projectId(), uuid);
        AssetVersion current = requireOpen(pageReference.getId());

        ObjectNode payload = current.getPayload().deepCopy();
        writeTarget(payload, targetKind, targetAssetUuid);
        com.acme.staticforge.project.LocaleConfig locales = projectLocales.forProject(ctx.projectId());
        if (locales.isLocalized()) {
            writeLocalizedLabel(payload, label, locales.canonicalDeclared(locale) != null
                    ? locales.canonicalDeclared(locale)
                    : locales.defaultLocale(), locales.defaultLocale());
        } else {
            writeLabel(payload, label);
        }

        return assetService.update(
                uuid, new UpdateAssetCommand(current.getDisplayName(), payload), expectedRevision, ctx);
    }

    @Override
    @Transactional(readOnly = true)
    public AssetVersionView find(long projectId, UUID uuid) {
        requirePageReference(projectId, uuid);
        return assetService.requireCurrent(projectId, uuid);
    }

    /**
     * Rejects a {@code target} whose {@code assetUuid} does not resolve to a live asset of the
     * declared {@code kind}: a {@code PAGE} target must be a live {@code PAGE}; a {@code FOLDER}
     * target must be a live {@code Folder} whose payload scope is {@code FolderScope.PAGES} (not
     * a navigation folder).
     */
    private void requireValidTarget(long projectId, PageReferenceTargetKind kind, UUID targetAssetUuid) {
        if (kind == null || targetAssetUuid == null) {
            throw new SfException(ProblemFactory.unprocessableEntity("PageReference target requires a kind and assetUuid."));
        }
        Asset target = assetRepository.findByProjectIdAndUuid(projectId, targetAssetUuid)
                .orElseThrow(() -> new SfException(ProblemFactory.unprocessableEntity(
                        "PageReference target " + targetAssetUuid + " does not exist.")));
        AssetVersion version = assetVersionRepository.findByAssetIdAndValidToRevisionIsNull(target.getId())
                .orElseThrow(() -> new SfException(ProblemFactory.unprocessableEntity(
                        "PageReference target " + targetAssetUuid + " does not exist.")));
        if (version.isDeleted()) {
            throw new SfException(ProblemFactory.unprocessableEntity(
                    "PageReference target " + targetAssetUuid + " has been deleted."));
        }

        if (kind == PageReferenceTargetKind.PAGE) {
            if (target.getAssetType() != AssetType.PAGE) {
                throw new SfException(ProblemFactory.unprocessableEntity(
                        "PageReference target is declared as PAGE but the asset is a " + target.getAssetType() + "."));
            }
            return;
        }

        if (target.getAssetType() != AssetType.FOLDER) {
            throw new SfException(ProblemFactory.unprocessableEntity(
                    "PageReference target is declared as FOLDER but the asset is a " + target.getAssetType() + "."));
        }
        FolderScope scope = FolderScope.fromPayload(version.getPayload());
        if (scope != FolderScope.PAGES) {
            throw new SfException(ProblemFactory.unprocessableEntity(
                    "PageReference FOLDER target must be a page-store folder (FolderScope.PAGES)."));
        }
        if (navigationService.firstNavigablePage(projectId, targetAssetUuid, navigationLookup).isEmpty()) {
            throw new SfException(ProblemFactory.other(
                    422,
                    "SF-DOM-0130",
                    "Validation Failed",
                    "PageReference FOLDER target " + targetAssetUuid + " has no page anywhere in its subtree."));
        }
    }

    private static void writeTarget(ObjectNode payload, PageReferenceTargetKind kind, UUID targetAssetUuid) {
        ObjectNode target = payload.putObject("target");
        target.put("kind", kind.name());
        target.put("assetUuid", targetAssetUuid.toString());
    }

    /**
     * Writes one language's label, wrapping a label stored before the project had locales as the
     * default language's translation (M24.2.2).
     */
    private static void writeLocalizedLabel(ObjectNode payload, String label, String locale, String defaultLocale) {
        com.fasterxml.jackson.databind.JsonNode current = payload.get("label");
        com.fasterxml.jackson.databind.JsonNode wrapper = com.acme.staticforge.common.L10nValues.isL10n(current)
                ? current
                : com.acme.staticforge.common.L10nValues.wrap(current, defaultLocale);
        payload.set("label", com.acme.staticforge.common.L10nValues.with(
                wrapper,
                locale,
                label == null || label.isBlank()
                        ? null
                        : com.fasterxml.jackson.databind.node.JsonNodeFactory.instance.textNode(label)));
    }

    private static void writeLabel(ObjectNode payload, String label) {
        if (label == null || label.isBlank()) {
            payload.putNull("label");
        } else {
            payload.put("label", label);
        }
    }

    private Asset requirePageReference(long projectId, UUID uuid) {
        Asset asset = assetRepository.findByProjectIdAndUuid(projectId, uuid)
                .orElseThrow(() -> new SfException(ProblemFactory.notFound("PageReference not found.")));
        if (asset.getAssetType() != AssetType.PAGE_REFERENCE) {
            throw new SfException(ProblemFactory.unprocessableEntity("Asset is not a PageReference."));
        }
        return asset;
    }

    private AssetVersion requireOpen(Long assetId) {
        return assetVersionRepository.findByAssetIdAndValidToRevisionIsNull(assetId)
                .orElseThrow(() -> new SfException(ProblemFactory.notFound("PageReference has no current version.")));
    }
}
