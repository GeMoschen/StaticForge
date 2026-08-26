package com.acme.staticforge.asset.page;

import com.acme.staticforge.asset.Asset;
import com.acme.staticforge.asset.AssetRepository;
import com.acme.staticforge.asset.AssetService;
import com.acme.staticforge.asset.AssetType;
import com.acme.staticforge.asset.AssetVersion;
import com.acme.staticforge.asset.AssetVersionRepository;
import com.acme.staticforge.asset.AssetVersionView;
import com.acme.staticforge.asset.CreateAssetCommand;
import com.acme.staticforge.asset.UpdateAssetCommand;
import com.acme.staticforge.common.JsonUtil;
import com.acme.staticforge.common.ProblemFactory;
import com.acme.staticforge.common.SfException;
import com.acme.staticforge.revision.RevisionAware;
import com.acme.staticforge.revision.RevisionContext;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.List;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * {@link PageService} implementation. Structural validation resolves {@code templateRef}
 * to a live {@code PAGE_TEMPLATE} and each section's {@code templateRef} to a live
 * {@code SECTION_TEMPLATE}; full CDL allow-lists arrive in M2, so any structurally valid
 * section is accepted for now (§10.5 note).
 */
@Service
@RevisionAware
public class PageServiceImpl implements PageService {

    private final AssetRepository assetRepository;
    private final AssetVersionRepository assetVersionRepository;
    private final AssetService assetService;
    private final BodyService bodyService;

    public PageServiceImpl(
            AssetRepository assetRepository,
            AssetVersionRepository assetVersionRepository,
            AssetService assetService,
            BodyService bodyService) {
        this.assetRepository = assetRepository;
        this.assetVersionRepository = assetVersionRepository;
        this.assetService = assetService;
        this.bodyService = bodyService;
    }

    @Override
    @Transactional
    public AssetVersionView create(CreatePageCommand cmd, RevisionContext ctx) {
        Template template = resolveTemplate(cmd.templateUuid(), ctx.projectId(), AssetType.PAGE_TEMPLATE);

        ObjectNode payload = JsonUtil.object(null);
        payload.put("templateRef", cmd.templateUuid().toString());
        payload.putObject("content");
        ObjectNode bodies = payload.putObject("bodies");
        declaredBodies(template).forEach(name -> bodies.putArray(name));
        ObjectNode nav = payload.putObject("nav");
        nav.put("visible", true);
        nav.put("position", 0);
        payload.putObject("output");
        payload.putObject("meta");

        return assetService.create(
                new CreateAssetCommand(
                        ctx.projectId(), AssetType.PAGE, cmd.displayName(), cmd.folderUuid(), payload, cmd.templateUuid()),
                ctx);
    }

    @Override
    @Transactional
    public AssetVersionView update(UUID uuid, JsonNode payload, long expectedRevision, RevisionContext ctx) {
        Asset page = requirePage(uuid, ctx.projectId());
        AssetVersion current = requireOpen(page.getId());

        ObjectNode newPayload = bodyService.mergePatch(null, payload);
        validatePagePayload(newPayload, ctx.projectId());

        String displayName = current.getDisplayName();
        return assetService.update(uuid, new UpdateAssetCommand(displayName, newPayload), expectedRevision, ctx);
    }

    @Override
    @Transactional
    public AssetVersionView patchContent(UUID uuid, JsonNode mergePatch, long expectedRevision, RevisionContext ctx) {
        Asset page = requirePage(uuid, ctx.projectId());
        AssetVersion current = requireOpen(page.getId());

        ObjectNode newPayload = bodyService.mergePatch(current.getPayload(), mergePatch);
        validatePagePayload(newPayload, ctx.projectId());

        return assetService.update(uuid, new UpdateAssetCommand(current.getDisplayName(), newPayload), expectedRevision, ctx);
    }

    @Override
    @Transactional
    public AssetVersionView addSection(
            UUID uuid, String bodyName, String templateUuid, Integer position, long expectedRevision, RevisionContext ctx) {
        requireSectionTemplate(templateUuid, ctx.projectId());
        Asset page = requirePage(uuid, ctx.projectId());
        AssetVersion current = requireOpen(page.getId());

        ObjectNode newPayload = bodyService.addSection(
                current.getPayload(), bodyName, templateUuid, position, UUID.randomUUID().toString());
        validatePagePayload(newPayload, ctx.projectId());

        return assetService.update(uuid, new UpdateAssetCommand(current.getDisplayName(), newPayload), expectedRevision, ctx);
    }

    @Override
    @Transactional
    public AssetVersionView reorderSections(
            UUID uuid, String bodyName, List<String> instanceIds, long expectedRevision, RevisionContext ctx) {
        Asset page = requirePage(uuid, ctx.projectId());
        AssetVersion current = requireOpen(page.getId());

        ObjectNode newPayload = bodyService.reorder(current.getPayload(), bodyName, instanceIds);
        validatePagePayload(newPayload, ctx.projectId());

        return assetService.update(uuid, new UpdateAssetCommand(current.getDisplayName(), newPayload), expectedRevision, ctx);
    }

    @Override
    @Transactional
    public AssetVersionView deleteSection(
            UUID uuid, String bodyName, String instanceId, long expectedRevision, RevisionContext ctx) {
        Asset page = requirePage(uuid, ctx.projectId());
        AssetVersion current = requireOpen(page.getId());

        ObjectNode newPayload = bodyService.removeSection(current.getPayload(), bodyName, instanceId);
        validatePagePayload(newPayload, ctx.projectId());

        return assetService.update(uuid, new UpdateAssetCommand(current.getDisplayName(), newPayload), expectedRevision, ctx);
    }

    @Override
    @Transactional
    public AssetVersionView moveSection(
            UUID sourcePageUuid,
            String sourceBody,
            String instanceId,
            UUID targetUuid,
            String targetBody,
            Integer position,
            long expectedTargetRevision,
            RevisionContext ctx) {
        if (sourcePageUuid.equals(targetUuid)) {
            Asset page = requirePage(targetUuid, ctx.projectId());
            AssetVersion current = requireOpen(page.getId());

            JsonNode section = bodyService.extractSection(current.getPayload(), sourceBody, instanceId);
            if (section == null) {
                throw new SfException(ProblemFactory.notFound("Section not found."));
            }
            ObjectNode withoutSection = bodyService.removeSection(current.getPayload(), sourceBody, instanceId);
            ObjectNode newPayload = bodyService.insertSection(withoutSection, targetBody, position, section);
            validatePagePayload(newPayload, ctx.projectId());

            return assetService.update(
                    targetUuid, new UpdateAssetCommand(current.getDisplayName(), newPayload), expectedTargetRevision, ctx);
        }

        Asset sourcePage = requirePage(sourcePageUuid, ctx.projectId());
        AssetVersion sourceCurrent = requireOpen(sourcePage.getId());

        JsonNode section = bodyService.extractSection(sourceCurrent.getPayload(), sourceBody, instanceId);
        if (section == null) {
            throw new SfException(ProblemFactory.notFound("Section not found."));
        }
        ObjectNode sourceNewPayload = bodyService.removeSection(sourceCurrent.getPayload(), sourceBody, instanceId);
        validatePagePayload(sourceNewPayload, ctx.projectId());
        assetService.update(
                sourcePageUuid,
                new UpdateAssetCommand(sourceCurrent.getDisplayName(), sourceNewPayload),
                sourceCurrent.getValidFromRevision(),
                ctx);

        Asset targetPage = requirePage(targetUuid, ctx.projectId());
        AssetVersion targetCurrent = requireOpen(targetPage.getId());
        ObjectNode targetNewPayload = bodyService.insertSection(targetCurrent.getPayload(), targetBody, position, section);
        validatePagePayload(targetNewPayload, ctx.projectId());

        return assetService.update(
                targetUuid, new UpdateAssetCommand(targetCurrent.getDisplayName(), targetNewPayload), expectedTargetRevision, ctx);
    }

    @Override
    @Transactional
    public AssetVersionView duplicate(UUID uuid, RevisionContext ctx) {
        Asset page = requirePage(uuid, ctx.projectId());
        AssetVersion current = requireOpen(page.getId());
        JsonNode payload = current.getPayload().deepCopy();

        return assetService.create(
                new CreateAssetCommand(
                        ctx.projectId(), AssetType.PAGE, current.getDisplayName(), current.getFolderId() == null
                                ? null
                                : folderUuid(current.getFolderId()),
                        payload, templateUuidOf(payload)),
                ctx);
    }

    @Override
    @Transactional(readOnly = true)
    public AssetVersionView find(long projectId, UUID uuid) {
        return assetService.requireCurrent(projectId, uuid);
    }

    @Override
    @Transactional(readOnly = true)
    public TemplateRefView resolveTemplate(long projectId, UUID uuid) {
        return resolveTemplate(uuid, projectId, AssetType.PAGE_TEMPLATE).view();
    }

    @Override
    @Transactional(readOnly = true)
    public List<AssetVersionView> list(long projectId, PageQuery query) {
        Long folderId = query.folderUuid() == null ? null : folderId(projectId, query.folderUuid());
        Long templateId = query.templateUuid() == null ? null : templateId(projectId, query.templateUuid());
        String q = query.q() == null ? null : query.q().toLowerCase();

        return assetVersionRepository.findCurrentByProjectAndType(projectId, AssetType.PAGE).stream()
                .filter(v -> folderId == null || folderId.equals(v.getFolderId()))
                .filter(v -> templateId == null || templateId.equals(v.getTemplateAssetId()))
                .filter(v -> q == null || v.getDisplayName().toLowerCase().contains(q))
                .map(this::toView)
                .toList();
    }

    private void validatePagePayload(ObjectNode payload, long projectId) {
        String templateRef = JsonUtil.text(payload, "templateRef").orElseThrow(
                () -> new SfException(ProblemFactory.unprocessableEntity("Page payload requires templateRef.")));
        resolveTemplate(UUID.fromString(templateRef), projectId, AssetType.PAGE_TEMPLATE);

        JsonNode bodies = payload.get("bodies");
        if (bodies != null && bodies.isObject()) {
            bodies.fields().forEachRemaining(entry -> {
                JsonNode value = entry.getValue();
                if (value != null && value.isArray()) {
                    value.forEach(section -> {
                        String sectionRef = section.path("templateRef").asText();
                        if (sectionRef != null && !sectionRef.isBlank()) {
                            requireSectionTemplate(sectionRef, projectId);
                        }
                    });
                }
            });
        }
    }

    private void requireSectionTemplate(String templateUuid, long projectId) {
        resolveTemplate(UUID.fromString(templateUuid), projectId, AssetType.SECTION_TEMPLATE);
    }

    private Template resolveTemplate(UUID templateUuid, long projectId, AssetType expectedType) {
        Asset template = assetRepository.findByProjectIdAndUuid(projectId, templateUuid)
                .orElseThrow(() -> new SfException(ProblemFactory.notFound("Template not found.")));
        if (template.getAssetType() != expectedType) {
            throw new SfException(ProblemFactory.unprocessableEntity("Template is not a " + expectedType + "."));
        }
        AssetVersion version = requireOpen(template.getId());
        if (version.isDeleted()) {
            throw new SfException(ProblemFactory.unprocessableEntity("Template has been deleted."));
        }
        return new Template(
                template.getId(),
                new TemplateRefView(template.getUuid(), template.getUid(), version.getDisplayName()));
    }

    private List<String> declaredBodies(Template template) {
        JsonNode payload = requireOpen(template.id()).getPayload();
        JsonNode bodies = payload.get("bodies");
        if (bodies == null || !bodies.isArray()) {
            return List.of();
        }
        java.util.ArrayList<String> names = new java.util.ArrayList<>();
        bodies.forEach(b -> {
            String name = b.path("name").asText();
            if (!name.isBlank()) {
                names.add(name);
            }
        });
        return names;
    }

    private Asset requirePage(UUID uuid, long projectId) {
        Asset asset = assetRepository.findByProjectIdAndUuid(projectId, uuid)
                .orElseThrow(() -> new SfException(ProblemFactory.notFound("Page not found.")));
        if (asset.getAssetType() != AssetType.PAGE) {
            throw new SfException(ProblemFactory.unprocessableEntity("Asset is not a page."));
        }
        return asset;
    }

    private AssetVersion requireOpen(Long assetId) {
        return assetVersionRepository.findByAssetIdAndValidToRevisionIsNull(assetId)
                .orElseThrow(() -> new SfException(ProblemFactory.notFound("Asset has no current version.")));
    }

    private Long folderId(long projectId, UUID folderUuid) {
        return assetRepository.findByProjectIdAndUuid(projectId, folderUuid).map(Asset::getId)
                .orElseThrow(() -> new SfException(ProblemFactory.notFound("Folder not found.")));
    }

    private UUID folderUuid(Long folderId) {
        return assetRepository.findById(folderId).map(Asset::getUuid)
                .orElseThrow(() -> new SfException(ProblemFactory.notFound("Folder not found.")));
    }

    private Long templateId(long projectId, UUID templateUuid) {
        return assetRepository.findByProjectIdAndUuid(projectId, templateUuid).map(Asset::getId)
                .orElseThrow(() -> new SfException(ProblemFactory.notFound("Template not found.")));
    }

    private UUID templateUuidOf(JsonNode payload) {
        String ref = JsonUtil.text(payload, "templateRef").orElse(null);
        return ref == null ? null : UUID.fromString(ref);
    }

    private AssetVersionView toView(AssetVersion version) {
        Asset asset = assetRepository.findById(version.getAssetId())
                .orElseThrow(() -> new SfException(ProblemFactory.notFound("Asset not found.")));
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

    private record Template(Long id, TemplateRefView view) {}
}
