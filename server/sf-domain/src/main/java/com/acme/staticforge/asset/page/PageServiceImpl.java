package com.acme.staticforge.asset.page;

import com.acme.staticforge.asset.Asset;
import com.acme.staticforge.asset.AssetRepository;
import com.acme.staticforge.asset.AssetService;
import com.acme.staticforge.asset.AssetType;
import com.acme.staticforge.asset.AssetUidHistoryRepository;
import com.acme.staticforge.asset.AssetVersion;
import com.acme.staticforge.asset.AssetVersionRepository;
import com.acme.staticforge.asset.AssetVersionView;
import com.acme.staticforge.asset.CreateAssetCommand;
import com.acme.staticforge.asset.UpdateAssetCommand;
import com.acme.staticforge.asset.content.ContentIssue;
import com.acme.staticforge.asset.rules.ContentRules;
import com.acme.staticforge.asset.template.TemplateHierarchies;
import com.acme.staticforge.common.JsonUtil;
import com.acme.staticforge.common.ProblemFactory;
import com.acme.staticforge.common.SfException;
import com.acme.staticforge.revision.RevisionAware;
import com.acme.staticforge.revision.RevisionContext;
import com.acme.staticforge.template.rules.RuleScope;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * {@link PageService} implementation. Structural validation resolves {@code templateRef}
 * to a live {@code PAGE_TEMPLATE} and each section's {@code templateRef} to a live
 * {@code SECTION_TEMPLATE}. Content is validated against those templates' CDL by
 * {@link PageContentValidation}: structural findings reject the save, including a section whose
 * template is outside its body's {@code allow} list (§10.5).
 */
@Service
@RevisionAware
public class PageServiceImpl implements PageService {

    private final AssetRepository assetRepository;
    private final AssetVersionRepository assetVersionRepository;
    private final AssetService assetService;
    private final BodyService bodyService;
    private final PageContentValidation contentValidation;
    private final TemplateHierarchies hierarchies;
    private final ContentRules contentRules;
    private final AssetUidHistoryRepository assetUidHistoryRepository;

    public PageServiceImpl(
            AssetRepository assetRepository,
            AssetVersionRepository assetVersionRepository,
            AssetService assetService,
            BodyService bodyService,
            PageContentValidation contentValidation,
            TemplateHierarchies hierarchies,
            ContentRules contentRules,
            AssetUidHistoryRepository assetUidHistoryRepository) {
        this.assetRepository = assetRepository;
        this.assetVersionRepository = assetVersionRepository;
        this.assetService = assetService;
        this.bodyService = bodyService;
        this.contentValidation = contentValidation;
        this.hierarchies = hierarchies;
        this.contentRules = contentRules;
        this.assetUidHistoryRepository = assetUidHistoryRepository;
    }

    @Override
    @Transactional
    public AssetVersionView create(CreatePageCommand cmd, RevisionContext ctx) {
        Template template = resolveTemplate(cmd.templateUuid(), ctx.projectId(), AssetType.PAGE_TEMPLATE);
        requireConcrete(template);

        ObjectNode payload = JsonUtil.object(null);
        payload.put("templateRef", cmd.templateUuid().toString());
        payload.putObject("content");
        ObjectNode bodies = payload.putObject("bodies");
        declaredBodies(ctx.projectId(), cmd.templateUuid()).forEach(name -> bodies.putArray(name));
        ObjectNode nav = payload.putObject(PageNav.NAV);
        nav.put("visible", true);
        nav.put("position", 0);
        nav.put(PageNav.NO_INDEX, false);
        payload.putObject("output");
        payload.putObject("meta");
        ObjectNode gated = contentRules.savePage(ctx.projectId(), null, null, payload);

        return assetService.create(
                new CreateAssetCommand(
                        ctx.projectId(), AssetType.PAGE, cmd.displayName(), cmd.folderUuid(), gated, cmd.templateUuid()),
                ctx);
    }

    @Override
    @Transactional
    public AssetVersionView update(UUID uuid, JsonNode payload, long expectedRevision, RevisionContext ctx) {
        Asset page = requirePage(uuid, ctx.projectId());
        AssetVersion current = requireOpen(page.getId());

        ObjectNode newPayload = bodyService.mergePatch(null, payload);
        validatePagePayload(newPayload, ctx.projectId());
        contentValidation.requireValidPage(ctx.projectId(), newPayload);
        newPayload = contentRules.savePage(ctx.projectId(), uuid, current.getPayload(), newPayload);

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
        if (mergePatch.has("content")) {
            contentValidation.requireValidContent(ctx.projectId(), newPayload);
        }
        if (mergePatch.path("bodies").isObject()) {
            mergePatch.get("bodies").fieldNames().forEachRemaining(
                    body -> contentValidation.requireValidBody(ctx.projectId(), newPayload, body));
        }
        ObjectNode gated = contentRules.savePage(ctx.projectId(), uuid, current.getPayload(), newPayload);

        return assetService.update(uuid, new UpdateAssetCommand(current.getDisplayName(), gated), expectedRevision, ctx);
    }

    @Override
    @Transactional
    public AssetVersionView addSection(
            UUID uuid, String bodyName, String templateUuid, Integer position, String explicitInstanceId, JsonNode content,
            long expectedRevision, RevisionContext ctx) {
        requireSectionTemplate(templateUuid, ctx.projectId());
        Asset page = requirePage(uuid, ctx.projectId());
        AssetVersion current = requireOpen(page.getId());

        if (content != null && !content.isObject()) {
            throw new SfException(ProblemFactory.unprocessableEntity("Section content must be a JSON object."));
        }
        String instanceId = explicitInstanceId == null || explicitInstanceId.isBlank()
                ? UUID.randomUUID().toString()
                : explicitInstanceId;
        if (instanceIdInUse(current.getPayload(), instanceId)) {
            throw new SfException(ProblemFactory.unprocessableEntity(
                    "A section with instanceId " + instanceId + " exists on this page already."));
        }
        ObjectNode newPayload =
                bodyService.addSection(current.getPayload(), bodyName, templateUuid, position, instanceId, content);
        validatePagePayload(newPayload, ctx.projectId());
        contentValidation.requireValidSection(ctx.projectId(), newPayload, bodyName, instanceId);
        ObjectNode gated = contentRules.savePage(ctx.projectId(), uuid, current.getPayload(), newPayload);

        return assetService.update(uuid, new UpdateAssetCommand(current.getDisplayName(), gated), expectedRevision, ctx);
    }

    /** Whether any body of {@code payload} holds a section with {@code instanceId}. */
    private static boolean instanceIdInUse(JsonNode payload, String instanceId) {
        JsonNode bodies = payload == null ? null : payload.get("bodies");
        if (bodies == null || !bodies.isObject()) {
            return false;
        }
        for (JsonNode body : bodies) {
            for (JsonNode section : body) {
                if (instanceId.equals(section.path("instanceId").asText())) {
                    return true;
                }
            }
        }
        return false;
    }

    @Override
    @Transactional
    public AssetVersionView reorderSections(
            UUID uuid, String bodyName, List<String> instanceIds, long expectedRevision, RevisionContext ctx) {
        Asset page = requirePage(uuid, ctx.projectId());
        AssetVersion current = requireOpen(page.getId());

        ObjectNode newPayload = bodyService.reorder(current.getPayload(), bodyName, instanceIds);
        validatePagePayload(newPayload, ctx.projectId());
        ObjectNode gated = contentRules.savePage(ctx.projectId(), uuid, current.getPayload(), newPayload);

        return assetService.update(uuid, new UpdateAssetCommand(current.getDisplayName(), gated), expectedRevision, ctx);
    }

    @Override
    @Transactional
    public AssetVersionView deleteSection(
            UUID uuid, String bodyName, String instanceId, long expectedRevision, RevisionContext ctx) {
        Asset page = requirePage(uuid, ctx.projectId());
        AssetVersion current = requireOpen(page.getId());

        ObjectNode newPayload = bodyService.removeSection(current.getPayload(), bodyName, instanceId);
        validatePagePayload(newPayload, ctx.projectId());
        ObjectNode gated = contentRules.savePage(ctx.projectId(), uuid, current.getPayload(), newPayload);

        return assetService.update(uuid, new UpdateAssetCommand(current.getDisplayName(), gated), expectedRevision, ctx);
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
            contentValidation.requireValidSection(ctx.projectId(), newPayload, targetBody, instanceId);
            ObjectNode gated = contentRules.savePage(ctx.projectId(), targetUuid, current.getPayload(), newPayload);

            return assetService.update(
                    targetUuid, new UpdateAssetCommand(current.getDisplayName(), gated), expectedTargetRevision, ctx);
        }

        Asset sourcePage = requirePage(sourcePageUuid, ctx.projectId());
        AssetVersion sourceCurrent = requireOpen(sourcePage.getId());

        JsonNode section = bodyService.extractSection(sourceCurrent.getPayload(), sourceBody, instanceId);
        if (section == null) {
            throw new SfException(ProblemFactory.notFound("Section not found."));
        }
        ObjectNode sourceNewPayload = bodyService.removeSection(sourceCurrent.getPayload(), sourceBody, instanceId);
        validatePagePayload(sourceNewPayload, ctx.projectId());
        sourceNewPayload = contentRules.savePage(ctx.projectId(), sourcePageUuid, sourceCurrent.getPayload(), sourceNewPayload);
        assetService.update(
                sourcePageUuid,
                new UpdateAssetCommand(sourceCurrent.getDisplayName(), sourceNewPayload),
                sourceCurrent.getValidFromRevision(),
                ctx);

        Asset targetPage = requirePage(targetUuid, ctx.projectId());
        AssetVersion targetCurrent = requireOpen(targetPage.getId());
        ObjectNode targetNewPayload = bodyService.insertSection(targetCurrent.getPayload(), targetBody, position, section);
        validatePagePayload(targetNewPayload, ctx.projectId());
        contentValidation.requireValidSection(ctx.projectId(), targetNewPayload, targetBody, instanceId);
        targetNewPayload = contentRules.savePage(ctx.projectId(), targetUuid, targetCurrent.getPayload(), targetNewPayload);

        return assetService.update(
                targetUuid, new UpdateAssetCommand(targetCurrent.getDisplayName(), targetNewPayload), expectedTargetRevision, ctx);
    }

    @Override
    @Transactional(readOnly = true)
    public AssetVersionView find(long projectId, UUID uuid) {
        return assetService.requireCurrent(projectId, uuid);
    }

    @Override
    @Transactional(readOnly = true)
    public List<ContentIssue> contentIssues(long projectId, JsonNode payload) {
        return contentIssues(projectId, null, payload);
    }

    @Override
    @Transactional(readOnly = true)
    public List<ContentIssue> contentIssues(long projectId, UUID pageUuid, JsonNode payload) {
        // The edit scope's outcome (M33): built-ins as before, plus the template's rules and states.
        return payload == null ? List.of() : contentRules.page(projectId, pageUuid, payload, RuleScope.EDIT, null).findings();
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

        Long revision = query.revision();
        List<AssetVersion> pages = revision == null
                ? assetVersionRepository.findCurrentByProjectAndType(projectId, AssetType.PAGE)
                : assetVersionRepository.findValidAtByProjectAndType(projectId, AssetType.PAGE, revision);
        Map<Long, String> uids = revision == null ? Map.of() : assetUidHistoryRepository.uidsAt(projectId, revision);
        return pages.stream()
                .filter(v -> folderId == null || folderId.equals(v.getFolderId()))
                .filter(v -> templateId == null || templateId.equals(v.getTemplateAssetId()))
                .filter(v -> q == null || v.getDisplayName().toLowerCase().contains(q))
                .map(v -> toView(v, uids))
                .toList();
    }

    /** {@code nav}, when present, is an object; its {@code noIndex}, when present, a boolean (M30, spec §10.3). */
    private static void requireValidNav(JsonNode nav) {
        if (nav == null || nav.isNull()) {
            return;
        }
        if (!nav.isObject()) {
            throw new SfException(ProblemFactory.unprocessableEntity("Page payload nav must be an object."));
        }
        JsonNode noIndex = nav.get(PageNav.NO_INDEX);
        if (noIndex != null && !noIndex.isNull() && !noIndex.isBoolean()) {
            throw new SfException(ProblemFactory.unprocessableEntity("Page payload nav.noIndex must be true or false."));
        }
    }

    private void validatePagePayload(ObjectNode payload, long projectId) {
        String templateRef = JsonUtil.text(payload, "templateRef").orElseThrow(
                () -> new SfException(ProblemFactory.unprocessableEntity("Page payload requires templateRef.")));
        UUID templateUuid = UUID.fromString(templateRef);
        Template template = resolveTemplate(templateUuid, projectId, AssetType.PAGE_TEMPLATE);
        requireConcrete(template);
        requireValidNav(payload.get(PageNav.NAV));

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
                new TemplateRefView(template.getUuid(), template.getUid(), version.getDisplayName()),
                version.getPayload().path("abstract").asBoolean(false));
    }

    /** 422 {@code SF-DOM-0123}: an abstract page template is a layout for other templates, never for pages (M20). */
    private static void requireConcrete(Template template) {
        if (template.abstractTemplate()) {
            throw new SfException(ProblemFactory.other(
                    422, "SF-DOM-0123", "Validation Failed",
                    "Template '" + template.view().uid() + "' is abstract: it is a layout for other templates and can't be"
                            + " used by pages. Choose a template that extends it."));
        }
    }

    /** The bodies of the page template's effective definition, inherited ones first (M20). */
    private List<String> declaredBodies(long projectId, UUID templateUuid) {
        return hierarchies.live(projectId).effectiveDefinition(templateUuid)
                .map(effective -> effective.definition().bodies().stream().map(body -> body.name()).toList())
                .orElse(List.of());
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
        return toView(version, Map.of());
    }

    /** {@code uids} holds the uid to show for assets whose uid differs from the current one (a time-travel read). */
    private AssetVersionView toView(AssetVersion version, Map<Long, String> uids) {
        Asset asset = assetRepository.findById(version.getAssetId())
                .orElseThrow(() -> new SfException(ProblemFactory.notFound("Asset not found.")));
        return new AssetVersionView(
                asset.getUuid(),
                uids.getOrDefault(asset.getId(), asset.getUid()),
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

    private record Template(Long id, TemplateRefView view, boolean abstractTemplate) {}
}
