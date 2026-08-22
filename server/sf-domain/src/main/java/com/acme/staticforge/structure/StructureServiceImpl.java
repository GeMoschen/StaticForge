package com.acme.staticforge.structure;

import com.acme.staticforge.asset.Asset;
import com.acme.staticforge.asset.AssetRepository;
import com.acme.staticforge.asset.AssetService;
import com.acme.staticforge.asset.AssetSummary;
import com.acme.staticforge.asset.AssetType;
import com.acme.staticforge.asset.AssetVersion;
import com.acme.staticforge.asset.AssetVersionRepository;
import com.acme.staticforge.asset.AssetVersionView;
import com.acme.staticforge.asset.AssetQuery;
import com.acme.staticforge.asset.CreateAssetCommand;
import com.acme.staticforge.asset.UpdateAssetCommand;
import com.acme.staticforge.common.Problem;
import com.acme.staticforge.common.ProblemFactory;
import com.acme.staticforge.common.SfException;
import com.acme.staticforge.revision.RevisionAware;
import com.acme.staticforge.revision.RevisionContext;
import com.acme.staticforge.template.diagnostic.Diagnostic;
import com.acme.staticforge.template.octl.OctlCompiler;
import com.acme.staticforge.template.octl.OctlResult;
import com.acme.staticforge.template.octl.ReferenceResolver;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
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
 * {@link StructureService} implementation. Owns the parse-on-save pipeline: the declarative
 * {@code sourceText} is parsed into a {@link StructureSource} (rejecting malformed source with
 * a 422) and each channel template is compile-checked. Persisted writes route through
 * {@link AssetService} so revisioning stays intact; the payload keeps the same
 * {@code channelTemplates} shape as page/section templates so the channel copy-from flow
 * ({@code ChannelService.seedFrom}) picks structures up automatically.
 */
@Service
@RevisionAware
public class StructureServiceImpl implements StructureService {

    private static final String PROBLEM_TYPE_422 = "https://cms.example.com/problems/sf-api-0422";

    private final AssetRepository assetRepository;
    private final AssetVersionRepository assetVersionRepository;
    private final AssetService assetService;
    private final ObjectMapper objectMapper;
    private final StructureSourceParser parser = new StructureSourceParser();
    private final OctlCompiler octlCompiler = new OctlCompiler();

    public StructureServiceImpl(
            AssetRepository assetRepository,
            AssetVersionRepository assetVersionRepository,
            AssetService assetService,
            ObjectMapper objectMapper) {
        this.assetRepository = assetRepository;
        this.assetVersionRepository = assetVersionRepository;
        this.assetService = assetService;
        this.objectMapper = objectMapper;
    }

    @Override
    @Transactional
    public StructureView create(
            long projectId,
            UUID parentFolderUuid,
            String displayName,
            StructureKind kind,
            String sourceText,
            Map<String, String> channelSources,
            RevisionContext ctx) {
        StructureKind effectiveKind = kind == null ? StructureKind.NAVIGATION : kind;
        StructureSource parsed = parser.parse(sourceText);
        ObjectNode payload = buildPayload(projectId, effectiveKind, sourceText, parsed, channelSources);

        AssetVersionView created = assetService.create(
                new CreateAssetCommand(projectId, AssetType.STRUCTURE, displayName, parentFolderUuid, payload, null),
                ctx);
        return toView(created);
    }

    @Override
    @Transactional
    public StructureView update(
            UUID uuid,
            String displayName,
            String sourceText,
            Map<String, String> channelSources,
            long expectedRevision,
            RevisionContext ctx) {
        Asset structure = requireStructure(uuid);
        StructureKind kind = readKind(requireOpen(structure.getId()).getPayload());
        StructureSource parsed = parser.parse(sourceText);
        ObjectNode payload = buildPayload(structure.getProjectId(), kind, sourceText, parsed, channelSources);

        AssetVersionView updated = assetService.update(
                uuid, new UpdateAssetCommand(displayName, payload), expectedRevision, ctx);
        return toView(updated);
    }

    @Override
    @Transactional(readOnly = true)
    public StructureView get(UUID uuid) {
        return toView(assetService.requireCurrent(uuid));
    }

    @Override
    @Transactional
    public StructureView saveChannel(
            UUID uuid, String channelKey, String octlSource, long expectedRevision, RevisionContext ctx) {
        Asset structure = requireStructure(uuid);
        AssetVersion current = requireOpen(structure.getId());

        OctlResult result = compileChannel(structure.getProjectId(), octlSource, channelKey);

        ObjectNode payload = (ObjectNode) current.getPayload().deepCopy();
        ObjectNode channel = payload.withObject("channelTemplates").withObject(channelKey);
        channel.put("source", octlSource);
        channel.put("compiledHash", result.template().hash());

        AssetVersionView updated = assetService.update(
                uuid, new UpdateAssetCommand(current.getDisplayName(), payload), expectedRevision, ctx);
        return toView(updated);
    }

    @Override
    @Transactional(readOnly = true)
    public Page<AssetSummary> list(long projectId, Pageable pageable) {
        return assetService.search(new AssetQuery(projectId, AssetType.STRUCTURE, null, null), pageable);
    }

    // ------------------------------------------------------------------
    // Compile-on-save
    // ------------------------------------------------------------------

    private OctlResult compileChannel(long projectId, String source, String channelKey) {
        OctlResult result = octlCompiler.compile(source, channelKey, referenceResolver(projectId));
        if (result.hasErrors()) {
            throw diagnosticsError(result.diagnostics());
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
            StructureKind kind,
            String sourceText,
            StructureSource parsed,
            Map<String, String> channelSources) {
        ObjectNode payload = objectMapper.createObjectNode();
        payload.put("kind", kind.name());
        payload.put("sourceText", sourceText == null ? "" : sourceText);
        payload.set("source", objectMapper.valueToTree(parsed));

        ObjectNode channelTemplates = payload.putObject("channelTemplates");
        if (channelSources != null) {
            for (Map.Entry<String, String> entry : channelSources.entrySet()) {
                OctlResult result = compileChannel(projectId, entry.getValue(), entry.getKey());
                ObjectNode channel = channelTemplates.putObject(entry.getKey());
                channel.put("source", entry.getValue());
                channel.put("compiledHash", result.template().hash());
            }
        }
        return payload;
    }

    private SfException diagnosticsError(List<Diagnostic> diagnostics) {
        Problem problem = Problem.builder()
                .type(PROBLEM_TYPE_422)
                .title("Validation Failed")
                .status(422)
                .detail("Structure has compile errors.")
                .property("code", "SF-API-0422")
                .property("diagnostics", diagnostics)
                .build();
        return new SfException(problem);
    }

    // ------------------------------------------------------------------
    // Lookups + guards
    // ------------------------------------------------------------------

    private Asset requireStructure(UUID uuid) {
        Asset asset = assetRepository.findByUuid(uuid)
                .orElseThrow(() -> new SfException(ProblemFactory.notFound("Structure not found.")));
        if (asset.getAssetType() != AssetType.STRUCTURE) {
            throw new SfException(ProblemFactory.unprocessableEntity("Asset is not a structure."));
        }
        return asset;
    }

    private AssetVersion requireOpen(Long assetId) {
        return assetVersionRepository.findByAssetIdAndValidToRevisionIsNull(assetId)
                .orElseThrow(() -> new SfException(ProblemFactory.notFound("Structure has no current version.")));
    }

    private StructureView toView(AssetVersionView view) {
        JsonNode payload = view.payload();
        return new StructureView(
                view.uuid(),
                view.uid(),
                view.displayName(),
                readKind(payload),
                payload.path("sourceText").asText(),
                payload.get("source"),
                payload.get("channelTemplates"),
                view.validFromRevision());
    }

    private static StructureKind readKind(JsonNode payload) {
        String name = payload == null ? "" : payload.path("kind").asText();
        try {
            return StructureKind.valueOf(name);
        } catch (IllegalArgumentException e) {
            return StructureKind.NAVIGATION;
        }
    }
}
