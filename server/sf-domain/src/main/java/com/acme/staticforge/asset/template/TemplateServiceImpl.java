package com.acme.staticforge.asset.template;

import com.acme.staticforge.asset.Asset;
import com.acme.staticforge.asset.AssetQuery;
import com.acme.staticforge.asset.AssetRepository;
import com.acme.staticforge.asset.AssetService;
import com.acme.staticforge.asset.AssetSummary;
import com.acme.staticforge.asset.AssetType;
import com.acme.staticforge.asset.AssetVersion;
import com.acme.staticforge.asset.AssetVersionRepository;
import com.acme.staticforge.asset.AssetVersionView;
import com.acme.staticforge.asset.CreateAssetCommand;
import com.acme.staticforge.asset.UpdateAssetCommand;
import com.acme.staticforge.common.Problem;
import com.acme.staticforge.common.ProblemFactory;
import com.acme.staticforge.common.SfException;
import com.acme.staticforge.revision.AssetChange;
import com.acme.staticforge.revision.ChangeType;
import com.acme.staticforge.revision.Revision;
import com.acme.staticforge.revision.RevisionAware;
import com.acme.staticforge.revision.RevisionContext;
import com.acme.staticforge.revision.RevisionService;
import com.acme.staticforge.template.cdl.CdlCompiler;
import com.acme.staticforge.template.cdl.CdlResult;
import com.acme.staticforge.template.content.BodyDefinition;
import com.acme.staticforge.template.content.ContentDefinition;
import com.acme.staticforge.template.content.EditorDefinition;
import com.acme.staticforge.template.diagnostic.Diagnostic;
import com.acme.staticforge.template.octl.OctlCompiler;
import com.acme.staticforge.template.octl.OctlResult;
import com.acme.staticforge.template.octl.ReferenceResolver;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Iterator;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * {@link TemplateService} implementation. Owns the compile-on-save pipeline: the CDL is
 * compiled into a {@link ContentDefinition} and each channel's OCTL into a
 * {@link com.acme.staticforge.template.octl.CompiledTemplate} against that definition plus a
 * project-scoped {@link ReferenceResolver}. Persisted writes route through
 * {@link AssetService} so revisioning stays intact; the CDL-change content migration is the
 * one exception, where every affected page is rewritten within a single allocated revision.
 */
@Service
@RevisionAware
public class TemplateServiceImpl implements TemplateService {

    private static final String PROBLEM_TYPE_422 = "https://cms.example.com/problems/sf-api-0422";

    private final AssetRepository assetRepository;
    private final AssetVersionRepository assetVersionRepository;
    private final AssetService assetService;
    private final RevisionService revisionService;
    private final ObjectMapper objectMapper;
    private final CdlCompiler cdlCompiler = new CdlCompiler();
    private final OctlCompiler octlCompiler = new OctlCompiler();

    public TemplateServiceImpl(
            AssetRepository assetRepository,
            AssetVersionRepository assetVersionRepository,
            AssetService assetService,
            RevisionService revisionService,
            ObjectMapper objectMapper) {
        this.assetRepository = assetRepository;
        this.assetVersionRepository = assetVersionRepository;
        this.assetService = assetService;
        this.revisionService = revisionService;
        this.objectMapper = objectMapper;
    }

    @Override
    @Transactional
    public TemplateView create(CreateTemplateCommand cmd, RevisionContext ctx) {
        requireKind(cmd.kind());
        ContentDefinition definition = compileDefinition(cmd.contentDefinition());
        ObjectNode payload = buildPayload(
                cmd.projectId(), cmd.kind(), cmd.contentDefinition(), cmd.channelSources(),
                cmd.category(), cmd.deprecated(), cmd.outputPath(), definition);

        AssetVersionView created = assetService.create(
                new CreateAssetCommand(cmd.projectId(), cmd.kind(), cmd.displayName(), null, payload, null), ctx);
        return toView(created);
    }

    @Override
    @Transactional
    public TemplateView update(UUID uuid, UpdateTemplateCommand cmd, long expectedRevision, RevisionContext ctx) {
        Asset template = requireTemplate(uuid);
        ContentDefinition definition = compileDefinition(cmd.contentDefinition());
        ObjectNode payload = buildPayload(
                template.getProjectId(), template.getAssetType(), cmd.contentDefinition(), cmd.channelSources(),
                cmd.category(), cmd.deprecated(), cmd.outputPath(), definition);

        AssetVersionView updated = assetService.update(
                uuid, new UpdateAssetCommand(cmd.displayName(), payload), expectedRevision, ctx);

        if (template.getAssetType() == AssetType.SECTION_TEMPLATE) {
            migrateRenames(template, definition, ctx);
        }
        return toView(updated);
    }

    @Override
    @Transactional
    public TemplateView saveChannel(UUID uuid, String channelKey, String octlSource, long expectedRevision, RevisionContext ctx) {
        Asset template = requireTemplate(uuid);
        AssetVersion current = requireOpen(template.getId());

        ContentDefinition definition = compileDefinition(current.getPayload().path("contentDefinition").asText(""));
        OctlResult result = compileChannel(template.getProjectId(), octlSource, channelKey, definition);

        ObjectNode payload = (ObjectNode) current.getPayload().deepCopy();
        ObjectNode channel = payload.withObject("channelTemplates").withObject(channelKey);
        channel.put("source", octlSource);
        channel.put("compiledHash", result.template().hash());

        AssetVersionView updated = assetService.update(
                uuid, new UpdateAssetCommand(current.getDisplayName(), payload), expectedRevision, ctx);
        return toView(updated);
    }

    @Override
    @Transactional
    public TemplateView deleteChannel(UUID uuid, String channelKey, long expectedRevision, RevisionContext ctx) {
        Asset template = requireTemplate(uuid);
        AssetVersion current = requireOpen(template.getId());

        ObjectNode payload = (ObjectNode) current.getPayload().deepCopy();
        payload.withObject("channelTemplates").remove(channelKey);

        AssetVersionView updated = assetService.update(
                uuid, new UpdateAssetCommand(current.getDisplayName(), payload), expectedRevision, ctx);
        return toView(updated);
    }

    @Override
    @Transactional(readOnly = true)
    public TemplateView get(UUID uuid) {
        return toView(assetService.requireCurrent(uuid));
    }

    @Override
    @Transactional(readOnly = true)
    public Page<AssetSummary> list(long projectId, AssetType kind, Pageable pageable) {
        return assetService.search(new AssetQuery(projectId, kind, null, null), pageable);
    }

    @Override
    @Transactional
    public void delete(UUID uuid, RevisionContext ctx) {
        requireTemplate(uuid);
        assetService.softDelete(uuid, false, ctx);
    }

    // ------------------------------------------------------------------
    // Compile-on-save
    // ------------------------------------------------------------------

    private ContentDefinition compileDefinition(String source) {
        CdlResult result = cdlCompiler.compile(source);
        if (result.hasErrors()) {
            throw diagnosticsError("CDL", result.diagnostics());
        }
        return result.definition();
    }

    private OctlResult compileChannel(long projectId, String source, String channelKey, ContentDefinition definition) {
        OctlResult result = octlCompiler.compile(source, channelKey, referenceResolver(projectId), definition);
        if (result.hasErrors()) {
            throw diagnosticsError("OCTL", result.diagnostics());
        }
        return result;
    }

    private ReferenceResolver referenceResolver(long projectId) {
        return (assetType, uid) -> {
            AssetType type;
            try {
                type = AssetType.valueOf(assetType.toUpperCase(Locale.ROOT));
            } catch (IllegalArgumentException | NullPointerException e) {
                return Optional.empty();
            }
            return assetRepository.findByProjectIdAndAssetTypeAndUid(projectId, type, uid).map(Asset::getUuid);
        };
    }

    private ObjectNode buildPayload(
            long projectId,
            AssetType kind,
            String contentDefinition,
            Map<String, String> channelSources,
            String category,
            boolean deprecated,
            Map<String, String> outputPath,
            ContentDefinition definition) {
        ObjectNode payload = objectMapper.createObjectNode();
        payload.put("contentDefinition", contentDefinition == null ? "" : contentDefinition);
        payload.set("compiledDefinition", objectMapper.valueToTree(definition));

        ObjectNode channelTemplates = payload.putObject("channelTemplates");
        for (Map.Entry<String, String> entry : channelSources.entrySet()) {
            OctlResult result = compileChannel(projectId, entry.getValue(), entry.getKey(), definition);
            ObjectNode channel = channelTemplates.putObject(entry.getKey());
            channel.put("source", entry.getValue());
            channel.put("compiledHash", result.template().hash());
        }

        payload.put("category", category == null ? "" : category);

        if (kind == AssetType.SECTION_TEMPLATE) {
            payload.put("deprecated", deprecated);
        } else {
            ArrayNode bodies = payload.putArray("bodies");
            for (BodyDefinition body : definition.bodies()) {
                ObjectNode node = bodies.addObject();
                node.put("name", body.name());
                node.put("label", body.label());
                ArrayNode allow = node.putArray("allow");
                body.allow().forEach(allow::add);
                if (body.min() != null) {
                    node.put("min", body.min());
                } else {
                    node.putNull("min");
                }
                if (body.max() != null) {
                    node.put("max", body.max());
                } else {
                    node.putNull("max");
                }
            }

            ObjectNode output = payload.putObject("outputPath");
            outputPath.forEach(output::put);
        }
        return payload;
    }

    private SfException diagnosticsError(String what, List<Diagnostic> diagnostics) {
        Problem problem = Problem.builder()
                .type(PROBLEM_TYPE_422)
                .title("Validation Failed")
                .status(422)
                .detail(what + " has compile errors.")
                .property("code", "SF-API-0422")
                .property("diagnostics", diagnostics)
                .build();
        return new SfException(problem);
    }

    // ------------------------------------------------------------------
    // CDL-change content migration (§12.3)
    // ------------------------------------------------------------------

    private void migrateRenames(Asset template, ContentDefinition definition, RevisionContext ctx) {
        List<EditorRename> renames = collectRenames(definition);
        if (renames.isEmpty()) {
            return;
        }

        String templateUuid = template.getUuid().toString();
        List<AffectedPage> affected = new ArrayList<>();
        for (AssetVersion page : assetVersionRepository.findCurrentByProjectAndType(ctx.projectId(), AssetType.PAGE)) {
            ObjectNode migrated = migratePagePayload(page.getPayload(), templateUuid, renames);
            if (migrated != null) {
                affected.add(new AffectedPage(page, migrated));
            }
        }
        if (affected.isEmpty()) {
            return;
        }

        Revision revision = revisionService.allocate(ctx.projectId(), ChangeType.UPDATE, ctx.comment(), ctx.userId());
        for (AffectedPage page : affected) {
            close(page.version().getAssetId(), revision.getRevisionId());
            insertVersion(page.version(), page.payload(), revision.getRevisionId(), ctx.userId());
            Asset asset = assetRepository.findById(page.version().getAssetId())
                    .orElseThrow(() -> new SfException(ProblemFactory.notFound("Page not found.")));
            appendSummary(asset, revision);
        }
    }

    private List<EditorRename> collectRenames(ContentDefinition definition) {
        List<EditorRename> renames = new ArrayList<>();
        for (EditorDefinition editor : definition.editors()) {
            String from = editor.renamedFrom();
            if (from != null && !from.isBlank() && !from.equals(editor.name())) {
                renames.add(new EditorRename(from, editor.name()));
            }
        }
        return renames;
    }

    private ObjectNode migratePagePayload(JsonNode payload, String templateUuid, List<EditorRename> renames) {
        JsonNode bodies = payload.get("bodies");
        if (bodies == null || !bodies.isObject()) {
            return null;
        }

        ObjectNode copy = (ObjectNode) payload.deepCopy();
        boolean changed = false;
        Iterator<Map.Entry<String, JsonNode>> bodyFields = copy.get("bodies").fields();
        while (bodyFields.hasNext()) {
            JsonNode sections = bodyFields.next().getValue();
            if (sections == null || !sections.isArray()) {
                continue;
            }
            for (JsonNode section : sections) {
                if (!templateUuid.equals(section.path("templateRef").asText())) {
                    continue;
                }
                JsonNode contentNode = section.get("content");
                if (contentNode == null || !contentNode.isObject()) {
                    continue;
                }
                ObjectNode content = (ObjectNode) contentNode;
                for (EditorRename rename : renames) {
                    if (content.has(rename.from())) {
                        content.set(rename.to(), content.get(rename.from()));
                        content.remove(rename.from());
                        changed = true;
                    }
                }
            }
        }
        return changed ? copy : null;
    }

    private void close(Long assetId, long revisionId) {
        assetVersionRepository.findByAssetIdAndValidToRevisionIsNull(assetId).ifPresent(version -> {
            version.setValidToRevision(revisionId);
            assetVersionRepository.save(version);
        });
    }

    private void insertVersion(AssetVersion current, JsonNode payload, long revisionId, Long changedBy) {
        AssetVersion next = new AssetVersion(
                current.getAssetId(), revisionId, current.getDisplayName(), payload, changedBy, Instant.now());
        next.setFolderId(current.getFolderId());
        next.setFolderPath(current.getFolderPath());
        next.setTemplateAssetId(current.getTemplateAssetId());
        next.setDeleted(current.isDeleted());
        assetVersionRepository.save(next);
    }

    private void appendSummary(Asset asset, Revision revision) {
        revisionService.appendSummary(
                asset.getProjectId(),
                revision.getRevisionId(),
                AssetChange.create(asset.getUuid().toString(), asset.getAssetType().name(), "UPDATE", List.of("bodies")));
    }

    // ------------------------------------------------------------------
    // Lookups + guards
    // ------------------------------------------------------------------

    private static void requireKind(AssetType kind) {
        if (kind != AssetType.SECTION_TEMPLATE && kind != AssetType.PAGE_TEMPLATE) {
            throw new SfException(ProblemFactory.unprocessableEntity("Unknown template kind."));
        }
    }

    private Asset requireTemplate(UUID uuid) {
        Asset asset = assetRepository.findByUuid(uuid)
                .orElseThrow(() -> new SfException(ProblemFactory.notFound("Template not found.")));
        if (asset.getAssetType() != AssetType.SECTION_TEMPLATE && asset.getAssetType() != AssetType.PAGE_TEMPLATE) {
            throw new SfException(ProblemFactory.unprocessableEntity("Asset is not a template."));
        }
        return asset;
    }

    private AssetVersion requireOpen(Long assetId) {
        return assetVersionRepository.findByAssetIdAndValidToRevisionIsNull(assetId)
                .orElseThrow(() -> new SfException(ProblemFactory.notFound("Template has no current version.")));
    }

    private TemplateView toView(AssetVersionView view) {
        return new TemplateView(
                view.uuid(), view.uid(), view.type(), view.displayName(), view.payload(),
                view.validFromRevision(), view.deleted());
    }

    private record EditorRename(String from, String to) {}

    private record AffectedPage(AssetVersion version, ObjectNode payload) {}
}
