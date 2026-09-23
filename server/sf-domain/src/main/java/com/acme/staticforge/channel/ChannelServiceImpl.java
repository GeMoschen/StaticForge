package com.acme.staticforge.channel;

import com.acme.staticforge.asset.Asset;
import com.acme.staticforge.asset.AssetRepository;
import com.acme.staticforge.asset.AssetType;
import com.acme.staticforge.asset.AssetVersion;
import com.acme.staticforge.asset.AssetVersionRepository;
import com.acme.staticforge.asset.reference.ReferenceMaterializer;
import com.acme.staticforge.audit.AuditService;
import com.acme.staticforge.common.Problem;
import com.acme.staticforge.common.ProblemFactory;
import com.acme.staticforge.common.SfException;
import com.acme.staticforge.revision.AssetChange;
import com.acme.staticforge.revision.ChangeType;
import com.acme.staticforge.revision.Revision;
import com.acme.staticforge.revision.RevisionAware;
import com.acme.staticforge.revision.RevisionContext;
import com.acme.staticforge.revision.RevisionService;
import com.acme.staticforge.template.render.Escaping;
import com.acme.staticforge.urlregistry.UrlRegistryRepository;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.regex.Pattern;
import java.util.stream.Collectors;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * {@link ChannelService} implementation. Channels are project-scoped configuration written
 * through the {@code output_channel} table; every mutation allocates a revision (spec §15) so
 * channel changes appear on the project's revision record. {@code html} is seeded on create and
 * non-deletable; deletion is blocked while templates still carry a channel template for the key.
 */
@Service
@RevisionAware
public class ChannelServiceImpl implements ChannelService {

    public static final String HTML_KEY = "html";
    private static final String HTML_DELETE_CODE = "SF-CH-0101";
    private static final String DELETE_BLOCKED_CODE = "SF-CH-0201";
    private static final String CHANNEL_ASSET_TYPE = "CHANNEL";
    private static final Pattern KEY_PATTERN = Pattern.compile("[a-z][a-z0-9_]{1,39}");

    /**
     * The asset types carrying per-channel OCTL under {@code channelTemplates.<channel>}: page and section
     * templates, and datasets with their record templates (M25.2.1). Copying a channel seeds them all; deleting
     * one is blocked by any of them.
     */
    private static final List<AssetType> CHANNEL_TEMPLATE_HOLDERS =
            List.of(AssetType.PAGE_TEMPLATE, AssetType.SECTION_TEMPLATE, AssetType.DATASET);

    private final OutputChannelRepository channelRepository;
    private final RevisionService revisionService;
    private final AssetRepository assetRepository;
    private final AssetVersionRepository assetVersionRepository;
    private final AuditService auditService;
    private final ObjectMapper objectMapper;
    private final UrlRegistryRepository urlRegistryRepository;
    private final ReferenceMaterializer referenceMaterializer;

    public ChannelServiceImpl(
            OutputChannelRepository channelRepository,
            RevisionService revisionService,
            AssetRepository assetRepository,
            AssetVersionRepository assetVersionRepository,
            AuditService auditService,
            ObjectMapper objectMapper,
            UrlRegistryRepository urlRegistryRepository,
            ReferenceMaterializer referenceMaterializer) {
        this.channelRepository = channelRepository;
        this.revisionService = revisionService;
        this.assetRepository = assetRepository;
        this.assetVersionRepository = assetVersionRepository;
        this.auditService = auditService;
        this.objectMapper = objectMapper;
        this.urlRegistryRepository = urlRegistryRepository;
        this.referenceMaterializer = referenceMaterializer;
    }

    @Override
    @Transactional(readOnly = true)
    public List<OutputChannel> list(long projectId) {
        return channelRepository.findByProjectIdOrderByPositionAsc(projectId);
    }

    @Override
    @Transactional
    public OutputChannel create(CreateChannelRequest req, RevisionContext ctx) {
        long projectId = ctx.projectId();
        String key = validateKey(req.key());
        validateOutputSettings(req.fileExtension(), req.settings());
        if (channelRepository.existsByProjectIdAndKey(projectId, key)) {
            throw new SfException(ProblemFactory.conflict("A channel with this key already exists."));
        }

        OutputChannel channel = channelRepository.save(new OutputChannel(
                projectId,
                key,
                defaultString(req.name(), key),
                req.fileExtension(),
                req.mimeType(),
                defaultString(req.defaultEscaping(), Escaping.HTML.name()),
                req.enabled(),
                req.isDefault(),
                req.position() == null ? 0 : req.position(),
                req.settings()));

        Revision revision = revisionService.allocate(projectId, ChangeType.CREATE, ctx.comment(), ctx.userId());
        revisionService.appendSummary(
                projectId,
                revision.getRevisionId(),
                AssetChange.create(channelUuid(key), CHANNEL_ASSET_TYPE, "CREATE", List.of("key", "name")));

        auditService.record(projectId, ctx.userId(), "CHANNEL_CREATE", "channel:" + key, channelDetail(key, req.name()));

        String copyFrom = req.copyFrom();
        if (copyFrom != null && !copyFrom.isBlank()) {
            seedFrom(key, copyFrom, ctx);
        }
        return channel;
    }

    @Override
    @Transactional
    public OutputChannel update(String key, UpdateChannelRequest req, RevisionContext ctx) {
        long projectId = ctx.projectId();
        OutputChannel channel = requireChannel(projectId, key);
        validateOutputSettings(req.fileExtension(), req.settings());
        ChannelOutputSettings previousOutput = ChannelOutputSettings.of(channel);
        List<String> outputFields = new ArrayList<>();
        if (!Objects.equals(defaultString(channel.getFileExtension(), ""), defaultString(req.fileExtension(), ""))) {
            outputFields.add("fileExtension");
        }
        if (req.settings() != null && !req.settings().equals(channel.getSettings())) {
            outputFields.add("settings");
        }

        channel.setName(defaultString(req.name(), key));
        channel.setFileExtension(req.fileExtension());
        channel.setMimeType(req.mimeType() == null ? channel.getMimeType() : req.mimeType());
        channel.setDefaultEscaping(defaultString(req.defaultEscaping(), Escaping.HTML.name()));
        channel.setEnabled(req.enabled());
        channel.setDefaultChannel(req.isDefault());
        channel.setPosition(req.position() == null ? channel.getPosition() : req.position());
        channel.setSettings(req.settings() == null ? channel.getSettings() : req.settings());
        channel = channelRepository.save(channel);

        Revision revision = revisionService.allocate(projectId, ChangeType.UPDATE, null, ctx.userId());
        if (!outputFields.isEmpty()) {
            // Recorded so an incremental build can tell that output paths may have moved.
            revisionService.appendSummary(
                    projectId,
                    revision.getRevisionId(),
                    AssetChange.create(channelUuid(key), CHANNEL_ASSET_TYPE, "UPDATE", outputFields));
        }
        if (!previousOutput.equals(ChannelOutputSettings.of(channel))) {
            // Registry entries are assign-once; computed ones would keep the old paths forever.
            urlRegistryRepository.deleteByProjectIdAndChannelKeyAndOverriddenFalse(projectId, key);
        }
        auditService.record(projectId, ctx.userId(), "CHANNEL_UPDATE", "channel:" + key, channelDetail(key, channel.getName()));
        return channel;
    }

    @Override
    @Transactional
    public OutputChannel setEnabled(String key, boolean enabled, RevisionContext ctx) {
        long projectId = ctx.projectId();
        OutputChannel channel = requireChannel(projectId, key);
        if (channel.isEnabled() != enabled) {
            channel.setEnabled(enabled);
            channel = channelRepository.save(channel);
            revisionService.allocate(projectId, ChangeType.UPDATE, null, ctx.userId());
        }
        return channel;
    }

    @Override
    @Transactional(readOnly = true)
    public DeletePreview previewDelete(long projectId, String key) {
        return new DeletePreview(affectedTemplates(projectId, key));
    }

    @Override
    @Transactional
    public void delete(String key, RevisionContext ctx) {
        long projectId = ctx.projectId();
        OutputChannel channel = requireChannel(projectId, key);
        if (HTML_KEY.equals(key)) {
            throw new SfException(ProblemFactory.other(
                    422, HTML_DELETE_CODE, "Validation Failed", "The html channel cannot be deleted."));
        }
        List<TemplateRef> affected = affectedTemplates(projectId, key);
        if (!affected.isEmpty()) {
            throw blockedError(affected);
        }
        channelRepository.delete(channel);
        revisionService.allocate(projectId, ChangeType.DELETE, ctx.comment(), ctx.userId());
        auditService.record(projectId, ctx.userId(), "CHANNEL_DELETE", "channel:" + key, channelDetail(key, channel.getName()));
    }

    @Override
    @Transactional(readOnly = true)
    public ChannelOutputSettings outputSettings(long projectId, String channelKey) {
        return channelRepository.findByProjectIdAndKey(projectId, channelKey)
                .map(ChannelOutputSettings::of)
                .orElseGet(() -> ChannelOutputSettings.defaults(channelKey));
    }

    @Override
    @Transactional(readOnly = true)
    public Map<String, ChannelOutputSettings> outputSettings(long projectId) {
        Map<String, ChannelOutputSettings> settings = new LinkedHashMap<>();
        for (OutputChannel channel : channelRepository.findByProjectIdOrderByPositionAsc(projectId)) {
            settings.put(channel.getKey(), ChannelOutputSettings.of(channel));
        }
        return settings;
    }

    @Override
    @Transactional(readOnly = true)
    public boolean outputSettingsChangedSince(long projectId, long revision) {
        for (Revision later : revisionService.findRecent(projectId, revision, null, null, Pageable.unpaged())) {
            JsonNode assets = later.getSummary() == null ? null : later.getSummary().get("assets");
            if (assets == null || !assets.isArray()) {
                continue;
            }
            for (JsonNode change : assets) {
                if (CHANNEL_ASSET_TYPE.equals(change.path("type").asText()) && changesOutput(change)) {
                    return true;
                }
            }
        }
        return false;
    }

    @Override
    @Transactional(readOnly = true)
    public Escaping defaultEscaping(long projectId, String channelKey) {
        OutputChannel channel = channelRepository.findByProjectIdAndKey(projectId, channelKey).orElse(null);
        if (channel == null) {
            return Escaping.HTML;
        }
        return toEscaping(channel.getDefaultEscaping());
    }

    @Override
    @Transactional
    public void seedFrom(String newChannelKey, String sourceChannelKey, RevisionContext ctx) {
        long projectId = ctx.projectId();
        List<SeedTarget> targets = new ArrayList<>();
        for (AssetType type : CHANNEL_TEMPLATE_HOLDERS) {
            for (AssetVersion version : assetVersionRepository.findCurrentByProjectAndType(projectId, type)) {
                JsonNode channelTemplates = version.getPayload() == null ? null : version.getPayload().get("channelTemplates");
                JsonNode source = channelTemplates == null ? null : channelTemplates.get(sourceChannelKey);
                if (source != null && !source.isNull()) {
                    targets.add(new SeedTarget(version, source));
                }
            }
        }
        if (targets.isEmpty()) {
            return;
        }

        Revision revision = revisionService.allocate(
                projectId, ChangeType.UPDATE, "copy channel " + sourceChannelKey + " to " + newChannelKey, ctx.userId());

        for (SeedTarget target : targets) {
            AssetVersion current = target.version();
            ObjectNode payload = (ObjectNode) current.getPayload().deepCopy();
            payload.withObject("channelTemplates").set(newChannelKey, target.source().deepCopy());

            Asset asset = assetRepository.findById(current.getAssetId())
                    .orElseThrow(() -> new SfException(ProblemFactory.notFound("Template not found.")));
            close(current.getAssetId(), revision.getRevisionId());
            insertVersion(asset, current, payload, revision.getRevisionId(), ctx.userId());
            appendSummary(asset, revision, List.of("channelTemplates"));
        }
    }

    @Override
    @Transactional
    public void ensureDefaultChannels(RevisionContext ctx) {
        long projectId = ctx.projectId();
        if (channelRepository.findByProjectIdAndKey(projectId, HTML_KEY).isPresent()) {
            return;
        }
        channelRepository.save(new OutputChannel(projectId, HTML_KEY, "HTML", "html", "text/html",
                Escaping.HTML.name(), true, true, 0, htmlSettings()));
    }

    // ------------------------------------------------------------------
    // Helpers
    // ------------------------------------------------------------------

    private List<TemplateRef> affectedTemplates(long projectId, String key) {
        List<TemplateRef> refs = new ArrayList<>();
        for (AssetType type : CHANNEL_TEMPLATE_HOLDERS) {
            for (AssetVersion version : assetVersionRepository.findCurrentByProjectAndType(projectId, type)) {
                JsonNode channelTemplates = version.getPayload() == null ? null : version.getPayload().get("channelTemplates");
                if (channelTemplates != null && channelTemplates.hasNonNull(key)) {
                    Asset asset = version.getAsset();
                    refs.add(new TemplateRef(
                            asset == null ? null : String.valueOf(asset.getUuid()),
                            asset == null ? null : asset.getUid(),
                            version.getDisplayName()));
                }
            }
        }
        return refs;
    }

    private SfException blockedError(List<TemplateRef> affected) {
        List<Map<String, String>> blocked = affected.stream()
                .map(t -> Map.of(
                        "uuid", t.uuid() == null ? "" : t.uuid(),
                        "uid", t.uid() == null ? "" : t.uid(),
                        "displayName", t.displayName() == null ? "" : t.displayName()))
                .toList();
        Problem problem = Problem.builder()
                .type("https://cms.example.com/problems/sf-ch-0201")
                .title("Conflict")
                .status(409)
                .detail("Channel still has templates. Delete or replace the affected channel templates first.")
                .property("code", DELETE_BLOCKED_CODE)
                .property("blockedBy", blocked)
                .build();
        return new SfException(problem);
    }

    private OutputChannel requireChannel(long projectId, String key) {
        return channelRepository.findByProjectIdAndKey(projectId, key)
                .orElseThrow(() -> new SfException(ProblemFactory.notFound("Channel not found.")));
    }

    private static String validateKey(String key) {
        if (key == null || key.isBlank()) {
            throw new SfException(ProblemFactory.badRequest("Channel key must not be blank."));
        }
        if (!KEY_PATTERN.matcher(key).matches()) {
            throw new SfException(ProblemFactory.badRequest(
                    "Channel key must match [a-z][a-z0-9_]{1,39}."));
        }
        return key;
    }

    /** 400 with one {@code fieldErrors} entry per invalid {@code fileExtension}/settings value. */
    private static void validateOutputSettings(String fileExtension, JsonNode settings) {
        List<ChannelOutputSettings.FieldError> errors = ChannelOutputSettings.validate(fileExtension, settings);
        if (errors.isEmpty()) {
            return;
        }
        Problem problem = Problem.builder()
                .type("https://cms.example.com/problems/sf-api-0400")
                .title("Bad Request")
                .status(400)
                .detail(errors.stream().map(e -> e.field() + " " + e.message()).collect(Collectors.joining("; ")))
                .property("code", "SF-API-0400")
                .property("fieldErrors", errors)
                .build();
        throw new SfException(problem);
    }

    /** A {@code CHANNEL} summary entry that can move output paths: a new channel, or a changed extension/settings. */
    private static boolean changesOutput(JsonNode change) {
        if ("CREATE".equals(change.path("action").asText())) {
            return true;
        }
        for (JsonNode field : change.path("fields")) {
            String name = field.asText();
            if ("fileExtension".equals(name) || "settings".equals(name)) {
                return true;
            }
        }
        return false;
    }

    private static String channelUuid(String key) {
        return "channel-" + key;
    }

    private static String defaultString(String value, String fallback) {
        return (value == null || value.isBlank()) ? fallback : value;
    }

    private JsonNode channelDetail(String key, String name) {
        return objectMapper.createObjectNode().put("key", key).put("name", name == null ? "" : name);
    }

    private static Escaping toEscaping(String name) {
        if (name == null) {
            return Escaping.HTML;
        }
        return switch (name.trim().toUpperCase(Locale.ROOT)) {
            case "MARKDOWN" -> Escaping.MARKDOWN;
            case "NONE" -> Escaping.NONE;
            default -> Escaping.HTML;
        };
    }

    private JsonNode htmlSettings() {
        try {
            return objectMapper.readTree("{\"indexFileName\":\"index.html\",\"urlStrategy\":\"RELATIVE\"}");
        } catch (Exception e) {
            return objectMapper.createObjectNode();
        }
    }

    private void close(Long assetId, long revisionId) {
        assetVersionRepository.findByAssetIdAndValidToRevisionIsNull(assetId).ifPresent(version -> {
            version.setValidToRevision(revisionId);
            assetVersionRepository.save(version);
        });
    }

    /** Inserts the new version and, in the same revision, syncs its outgoing reference rows (§5.4). */
    private void insertVersion(Asset asset, AssetVersion current, JsonNode payload, long revisionId, Long changedBy) {
        AssetVersion next = new AssetVersion(
                current.getAssetId(), revisionId, current.getDisplayName(), payload, changedBy, Instant.now());
        next.setFolderId(current.getFolderId());
        next.setFolderPath(current.getFolderPath());
        next.setTemplateAssetId(current.getTemplateAssetId());
        next.setDeleted(current.isDeleted());
        referenceMaterializer.materialize(asset, assetVersionRepository.save(next));
    }

    private void appendSummary(Asset asset, Revision revision, List<String> fields) {
        revisionService.appendSummary(
                asset.getProjectId(),
                revision.getRevisionId(),
                AssetChange.create(asset.getUuid().toString(), asset.getAssetType().name(), "UPDATE", fields));
    }

    private record SeedTarget(AssetVersion version, JsonNode source) {}
}
