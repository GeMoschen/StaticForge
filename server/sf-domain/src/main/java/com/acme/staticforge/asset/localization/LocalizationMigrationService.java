package com.acme.staticforge.asset.localization;

import com.acme.staticforge.asset.Asset;
import com.acme.staticforge.asset.AssetRepository;
import com.acme.staticforge.asset.AssetType;
import com.acme.staticforge.asset.AssetVersion;
import com.acme.staticforge.asset.AssetVersionRepository;
import com.acme.staticforge.asset.content.LocalizationContext;
import com.acme.staticforge.asset.content.LocalizationMigrator;
import com.acme.staticforge.asset.content.SectionTemplateLookup;
import com.acme.staticforge.asset.content.TemplateContentDefinitions;
import com.acme.staticforge.asset.page.PageContentValidation;
import com.acme.staticforge.asset.reference.ReferenceMaterializer;
import com.acme.staticforge.asset.template.TemplateHierarchies;
import com.acme.staticforge.release.ReleaseCarryForward;
import com.acme.staticforge.revision.AssetChange;
import com.acme.staticforge.revision.ChangeType;
import com.acme.staticforge.revision.Revision;
import com.acme.staticforge.revision.RevisionContext;
import com.acme.staticforge.revision.RevisionService;
import com.acme.staticforge.template.cdl.CdlSources;
import com.acme.staticforge.template.content.ContentDefinition;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Rewrites stored content when the language-dependence of a value changes (M24.2.2): a template
 * editor gains or loses {@code localizable}, or a project gains or loses locales.
 *
 * <p>Every trigger runs the same normalization ({@link LocalizationMigrator}) over the same
 * asset walk, inside <em>one</em> compound revision (M15 {@code beginBatch}), and every
 * unwrapping run is preceded by a dry run: translations are never dropped without the caller
 * passing {@code confirmDiscard}.
 */
@Service
public class LocalizationMigrationService {

    private final AssetRepository assetRepository;
    private final AssetVersionRepository assetVersionRepository;
    private final RevisionService revisionService;
    private final ReferenceMaterializer referenceMaterializer;
    private final TemplateHierarchies hierarchies;
    private final PageContentValidation pageContentValidation;
    private final ReleaseCarryForward releaseCarryForward;

    public LocalizationMigrationService(
            AssetRepository assetRepository,
            AssetVersionRepository assetVersionRepository,
            RevisionService revisionService,
            ReferenceMaterializer referenceMaterializer,
            TemplateHierarchies hierarchies,
            PageContentValidation pageContentValidation,
            ReleaseCarryForward releaseCarryForward) {
        this.assetRepository = assetRepository;
        this.assetVersionRepository = assetVersionRepository;
        this.revisionService = revisionService;
        this.referenceMaterializer = referenceMaterializer;
        this.hierarchies = hierarchies;
        this.pageContentValidation = pageContentValidation;
        this.releaseCarryForward = releaseCarryForward;
    }

    /**
     * What a migration did, or would do.
     *
     * @param affectedAssets the UUIDs of the assets whose content is rewritten
     * @param discardedLocaleValues how many stored translations are dropped
     * @param discardedLocales which locales lose values, in first-seen order
     * @param applied {@code false} for a dry run
     */
    public record MigrationReport(
            List<UUID> affectedAssets, int discardedLocaleValues, List<String> discardedLocales, boolean applied) {

        public static final MigrationReport NOTHING = new MigrationReport(List.of(), 0, List.of(), true);

        public MigrationReport {
            affectedAssets = affectedAssets == null ? List.of() : List.copyOf(affectedAssets);
            discardedLocales = discardedLocales == null ? List.of() : List.copyOf(discardedLocales);
        }

        /** {@code true} when applying this migration would drop translations. */
        public boolean requiresConfirmation() {
            return discardedLocaleValues > 0;
        }

        public boolean isEmpty() {
            return affectedAssets.isEmpty();
        }
    }

    /**
     * Normalizes every content-holding asset of the project against {@code target} — the
     * project-driven migration behind {@code PUT /projects/{key}/locales}.
     *
     * @param ctx a context whose open revision the rewrites join, so the settings change and the
     *     content it migrates are one revision
     * @param apply {@code false} reports what would happen without writing
     */
    @Transactional
    public MigrationReport migrateProject(long projectId, LocalizationContext target, RevisionContext ctx, boolean apply) {
        return run(projectId, target, ctx, apply, candidates(projectId));
    }

    /**
     * Normalizes the pages and records that store values for {@code templateUuid} — the
     * template-driven migration behind a template save whose CDL changed {@code localizable}.
     */
    @Transactional
    public MigrationReport migrateTemplate(
            long projectId, UUID templateUuid, LocalizationContext target, RevisionContext ctx, boolean apply) {
        String ref = templateUuid.toString();
        List<AssetVersion> touched = candidates(projectId).stream()
                .filter(version -> usesTemplate(version, ref))
                .toList();
        return run(projectId, target, ctx, apply, touched);
    }

    /**
     * How many stored translations exist for any of {@code locales} across the project — the
     * "these values are kept, not deleted" count the Languages settings tab shows after a locale
     * is removed.
     */
    @Transactional(readOnly = true)
    public int countValuesForLocales(long projectId, List<String> locales) {
        int count = 0;
        for (AssetVersion version : candidates(projectId)) {
            count += countIn(version.getPayload(), locales);
        }
        return count;
    }

    private static int countIn(JsonNode node, List<String> locales) {
        if (node == null || !node.isContainerNode()) {
            return 0;
        }
        if (com.acme.staticforge.common.L10nValues.isL10n(node)) {
            return (int) com.acme.staticforge.common.L10nValues.locales(node).stream()
                    .filter(stored -> locales.stream().anyMatch(stored::equalsIgnoreCase))
                    .count();
        }
        int count = 0;
        for (JsonNode child : node) {
            count += countIn(child, locales);
        }
        return count;
    }

    /** Every current, non-deleted asset whose payload can hold editor values. */
    private List<AssetVersion> candidates(long projectId) {
        List<AssetVersion> out = new ArrayList<>();
        for (AssetType type : List.of(AssetType.PAGE, AssetType.GLOBAL_SET, AssetType.RECORD)) {
            assetVersionRepository.findCurrentByProjectAndType(projectId, type).stream()
                    .filter(version -> !version.isDeleted())
                    .forEach(out::add);
        }
        return out;
    }

    /** Whether {@code version}'s payload stores values governed by the template {@code ref}. */
    private static boolean usesTemplate(AssetVersion version, String ref) {
        JsonNode payload = version.getPayload();
        if (ref.equals(payload.path("templateRef").asText(null))
                || ref.equals(payload.path("datasetRef").asText(null))
                || ref.equals(payload.path("schemaRef").asText(null))) {
            return true;
        }
        JsonNode bodies = payload.get("bodies");
        if (bodies != null && bodies.isObject()) {
            for (JsonNode sections : iterable(bodies)) {
                for (JsonNode section : sections) {
                    if (ref.equals(section.path("templateRef").asText(null))) {
                        return true;
                    }
                }
            }
        }
        return containsCardOf(payload.get("content"), ref);
    }

    private static Iterable<JsonNode> iterable(JsonNode node) {
        return node;
    }

    private static boolean containsCardOf(JsonNode node, String ref) {
        if (node == null || !node.isContainerNode()) {
            return false;
        }
        if (node.isObject() && ref.equals(node.path("templateRef").asText(null))
                && node.hasNonNull("instanceId")) {
            return true;
        }
        for (JsonNode child : node) {
            if (containsCardOf(child, ref)) {
                return true;
            }
        }
        return false;
    }

    private MigrationReport run(
            long projectId, LocalizationContext target, RevisionContext ctx, boolean apply, List<AssetVersion> versions) {
        SectionTemplateLookup sections = pageContentValidation.sectionTemplates(projectId);
        Map<UUID, ContentDefinition> pageDefinitions = new LinkedHashMap<>();
        List<Rewrite> rewrites = new ArrayList<>();
        int discarded = 0;
        List<String> discardedLocales = new ArrayList<>();

        for (AssetVersion version : versions) {
            ObjectNode payload = (ObjectNode) version.getPayload().deepCopy();
            LocalizationMigrator.Plan plan = normalizePayload(projectId, payload, target, sections, pageDefinitions);
            if (!plan.changed()) {
                continue;
            }
            Asset asset = asset(version);
            rewrites.add(new Rewrite(version, asset, payload));
            for (LocalizationMigrator.Discard discard : plan.discards()) {
                discarded += discard.locales().size();
                discard.locales().forEach(locale -> {
                    if (!discardedLocales.contains(locale)) {
                        discardedLocales.add(locale);
                    }
                });
            }
        }

        List<UUID> affected = rewrites.stream().map(r -> r.asset().getUuid()).toList();
        if (!apply || rewrites.isEmpty()) {
            return new MigrationReport(affected, discarded, discardedLocales, false);
        }

        Revision revision = revision(projectId, ctx);
        List<AssetChange> changes = new ArrayList<>();
        List<ReleaseCarryForward.Rewrite> rewritten = new ArrayList<>();
        for (Rewrite rewrite : rewrites) {
            close(rewrite.version().getAssetId(), revision.getRevisionId());
            AssetVersion next = insertVersion(rewrite, revision.getRevisionId(), ctx.userId());
            rewritten.add(new ReleaseCarryForward.Rewrite(
                    rewrite.version().getAssetId(), rewrite.version().getId(), next.getId()));
            changes.add(AssetChange.create(
                    rewrite.asset().getUuid().toString(),
                    rewrite.asset().getAssetType().name(),
                    "UPDATE",
                    List.of("content")));
        }
        revisionService.appendSummaries(projectId, revision.getRevisionId(), changes);
        // Published content stays published: the rewrite changes the shape, not what a locale shows (M27.1.2).
        releaseCarryForward.carryForward(projectId, rewritten, revision.getRevisionId());
        return new MigrationReport(affected, discarded, discardedLocales, true);
    }

    /**
     * Normalizes an asset payload: the page's own {@code content} against its effective template
     * definition, each body section and catalog card against its own section template, and a
     * global set's or record's {@code content} against its own stored schema.
     */
    private LocalizationMigrator.Plan normalizePayload(
            long projectId,
            ObjectNode payload,
            LocalizationContext target,
            SectionTemplateLookup sections,
            Map<UUID, ContentDefinition> pageDefinitions) {
        List<LocalizationMigrator.Discard> discards = new ArrayList<>();
        boolean changed = false;

        ContentDefinition own = ownDefinition(projectId, payload, pageDefinitions);
        if (own != null && payload.get("content") instanceof ObjectNode content) {
            changed |= collect(LocalizationMigrator.normalize(content, own, target, true), "content", discards);
        }

        JsonNode bodies = payload.get("bodies");
        if (bodies != null && bodies.isObject()) {
            var fields = bodies.fields();
            while (fields.hasNext()) {
                var entry = fields.next();
                JsonNode list = entry.getValue();
                if (!list.isArray()) {
                    continue;
                }
                for (int i = 0; i < list.size(); i++) {
                    changed |= normalizeInstance(
                            list.get(i), target, sections, "bodies." + entry.getKey() + "[" + i + "]", discards);
                }
            }
        }

        changed |= normalizeCards(payload.get("content"), target, sections, "content", discards);
        return new LocalizationMigrator.Plan(changed, discards);
    }

    /** A section instance's own content, against its section template's definition. */
    private boolean normalizeInstance(
            JsonNode instance,
            LocalizationContext target,
            SectionTemplateLookup sections,
            String path,
            List<LocalizationMigrator.Discard> discards) {
        if (!(instance instanceof ObjectNode node) || !(node.get("content") instanceof ObjectNode content)) {
            return false;
        }
        Optional<SectionTemplateLookup.SectionTemplate> template =
                sections.find(node.path("templateRef").asText(""));
        if (template.isEmpty()) {
            return false;
        }
        boolean changed = collect(
                LocalizationMigrator.normalize(content, template.get().definition(), target, true),
                path + ".content",
                discards);
        // A card may itself hold a catalog editor: keep descending.
        return changed | normalizeCards(content, target, sections, path + ".content", discards);
    }

    /** Every catalog card anywhere under {@code node}, each against its own section template. */
    private boolean normalizeCards(
            JsonNode node,
            LocalizationContext target,
            SectionTemplateLookup sections,
            String path,
            List<LocalizationMigrator.Discard> discards) {
        if (node == null || !node.isObject()) {
            return false;
        }
        boolean changed = false;
        var fields = node.fields();
        while (fields.hasNext()) {
            var entry = fields.next();
            JsonNode value = entry.getValue();
            if (!value.isObject() || !"CATALOG".equals(value.path("type").asText(null))) {
                continue;
            }
            JsonNode cards = value.path("cards");
            for (int i = 0; i < cards.size(); i++) {
                changed |= normalizeInstance(
                        cards.get(i), target, sections, path + "." + entry.getKey() + "[" + i + "]", discards);
            }
        }
        return changed;
    }

    private static boolean collect(
            LocalizationMigrator.Plan plan, String prefix, List<LocalizationMigrator.Discard> discards) {
        plan.discards().forEach(d -> discards.add(new LocalizationMigrator.Discard(prefix + "." + d.path(), d.locales())));
        return plan.changed();
    }

    /**
     * The definition governing an asset's own {@code content}: a page's effective page-template
     * definition (own + inherited editors), or the schema a global set / record stores with its
     * values.
     */
    private ContentDefinition ownDefinition(
            long projectId, JsonNode payload, Map<UUID, ContentDefinition> pageDefinitions) {
        String templateRef = payload.path("templateRef").asText(null);
        if (templateRef != null) {
            UUID uuid;
            try {
                uuid = UUID.fromString(templateRef);
            } catch (IllegalArgumentException e) {
                return null;
            }
            return pageDefinitions.computeIfAbsent(uuid, key -> hierarchies.live(projectId)
                    .effectiveDefinition(key)
                    .map(effective -> effective.definition())
                    .orElse(null));
        }
        // Global sets store their compiled schema with their values (M17); records point at their
        // dataset's schema, which the dataset asset holds.
        if (CdlSources.presentIn(payload) || payload.has("compiledDefinition")) {
            return TemplateContentDefinitions.of(payload);
        }
        String schemaRef = payload.path("datasetRef").asText(null);
        if (schemaRef == null) {
            return null;
        }
        UUID uuid;
        try {
            uuid = UUID.fromString(schemaRef);
        } catch (IllegalArgumentException e) {
            return null;
        }
        return pageDefinitions.computeIfAbsent(uuid, key -> assetRepository.findByProjectIdAndUuid(projectId, key)
                .flatMap(asset -> assetVersionRepository.findByAssetIdAndValidToRevisionIsNull(asset.getId()))
                .map(version -> TemplateContentDefinitions.of(version.getPayload()))
                .orElse(null));
    }

    /** Joins the caller's open batch when there is one, otherwise opens a batch of its own. */
    private Revision revision(long projectId, RevisionContext ctx) {
        if (ctx.openRevision() != null) {
            return ctx.openRevision();
        }
        return revisionService.beginBatch(projectId, ChangeType.UPDATE, ctx.comment(), ctx.userId());
    }

    private Asset asset(AssetVersion version) {
        Asset asset = version.getAsset();
        return asset != null
                ? asset
                : assetRepository.findById(version.getAssetId()).orElseThrow(() -> new IllegalStateException(
                        "Asset " + version.getAssetId() + " has a version but no row."));
    }

    private void close(Long assetId, long revisionId) {
        assetVersionRepository.findByAssetIdAndValidToRevisionIsNull(assetId).ifPresent(version -> {
            version.setValidToRevision(revisionId);
            assetVersionRepository.save(version);
        });
    }

    private AssetVersion insertVersion(Rewrite rewrite, long revisionId, Long changedBy) {
        AssetVersion current = rewrite.version();
        AssetVersion next = new AssetVersion(
                current.getAssetId(), revisionId, current.getDisplayName(), rewrite.payload(), changedBy, Instant.now());
        next.setFolderId(current.getFolderId());
        next.setFolderPath(current.getFolderPath());
        next.setTemplateAssetId(current.getTemplateAssetId());
        next.setDeleted(current.isDeleted());
        next.setAsset(rewrite.asset());
        next.projectMediaColumns(rewrite.asset().getAssetType());
        AssetVersion saved = assetVersionRepository.save(next);
        referenceMaterializer.materialize(rewrite.asset(), saved);
        return saved;
    }

    private record Rewrite(AssetVersion version, Asset asset, ObjectNode payload) {}
}
