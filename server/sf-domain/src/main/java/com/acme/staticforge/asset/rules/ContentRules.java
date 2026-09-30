package com.acme.staticforge.asset.rules;

import com.acme.staticforge.asset.Asset;
import com.acme.staticforge.asset.AssetRepository;
import com.acme.staticforge.asset.AssetType;
import com.acme.staticforge.asset.AssetVersion;
import com.acme.staticforge.asset.AssetVersionRepository;
import com.acme.staticforge.asset.content.ContentIssue;
import com.acme.staticforge.asset.content.LocalizationContext;
import com.acme.staticforge.asset.content.PaginationSourceLookup;
import com.acme.staticforge.asset.content.SectionTemplateLookup;
import com.acme.staticforge.asset.dataset.RecordDatasets;
import com.acme.staticforge.asset.page.PageContentValidation;
import com.acme.staticforge.asset.template.TemplateHierarchies;
import com.acme.staticforge.asset.template.TemplateHierarchy;
import com.acme.staticforge.common.ProblemFactory;
import com.acme.staticforge.common.SfException;
import com.acme.staticforge.project.ProjectLocales;
import com.acme.staticforge.template.cdl.CdlCompiler;
import com.acme.staticforge.template.content.ContentDefinition;
import com.acme.staticforge.template.content.EffectiveDefinition;
import com.acme.staticforge.template.diagnostic.Severity;
import com.acme.staticforge.template.expression.ExpressionValues;
import com.acme.staticforge.template.rules.FillMode;
import com.acme.staticforge.template.rules.RuleScope;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.ArrayList;
import java.util.Collection;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

/**
 * Editor rules on live content (M33.4, M33.5): the {@code edit} outcome the editor shows for a draft or an unsaved form
 * value, and the <b>save rule gate</b> every save path runs. Reads drafts ({@link RuleContexts#draft}).
 *
 * <p>The gate's order (epic decision 7): (1) a field whose {@code readOnlyWhen} holds on the <em>stored</em> version
 * keeps its stored value — a changed value is ignored with an {@code info} finding {@code read-only}; (2) the save
 * fills run ({@code mode always} overwrites; a value the user typed into such a field is ignored with a
 * {@code read-only} info as well); (3) the save rules run, and a save-scope {@code error} rejects the save — autosave
 * included — with {@code 422 SF-API-0422} and every finding under {@code issues}. Structural findings keep their own,
 * earlier checks. The stored content is the filled and enforced one; the gate's findings go to
 * {@link SaveFindings}.
 */
@Component
public class ContentRules {

    private final RecordDatasets recordDatasets;
    private final PageContentValidation pageContentValidation;
    private final TemplateHierarchies hierarchies;
    private final RuleContexts contexts;
    private final AssetRepository assetRepository;
    private final AssetVersionRepository versionRepository;
    private final ProjectLocales projectLocales;
    private final CdlCompiler cdlCompiler = new CdlCompiler();

    public ContentRules(
            RecordDatasets recordDatasets,
            PageContentValidation pageContentValidation,
            TemplateHierarchies hierarchies,
            RuleContexts contexts,
            AssetRepository assetRepository,
            AssetVersionRepository versionRepository,
            ProjectLocales projectLocales) {
        this.recordDatasets = recordDatasets;
        this.pageContentValidation = pageContentValidation;
        this.hierarchies = hierarchies;
        this.contexts = contexts;
        this.assetRepository = assetRepository;
        this.versionRepository = versionRepository;
        this.projectLocales = projectLocales;
    }

    private RuleEngine engine(long projectId) {
        return new RuleEngine(recordDatasets.validator(projectId).withUiLanguage(UiLanguage.current()));
    }

    /** The effective definition of a page payload's template; empty when it doesn't resolve. */
    public Optional<ContentDefinition> pageDefinition(long projectId, JsonNode payload) {
        UUID template;
        try {
            template = UUID.fromString(payload == null ? "" : payload.path("templateRef").asText(""));
        } catch (IllegalArgumentException e) {
            return Optional.empty();
        }
        return hierarchies.live(projectId).effectiveDefinition(template).map(EffectiveDefinition::definition);
    }

    // ------------------------------------------------------------------
    // Outcomes
    // ------------------------------------------------------------------

    /**
     * The rule outcome of a page payload in {@code scope} over the drafts.
     *
     * @param pageUuid the page, {@code null} while it is being created
     * @param locales the languages to evaluate, {@code null} for all
     */
    public RuleOutcome page(long projectId, UUID pageUuid, JsonNode payload, RuleScope scope, Collection<String> locales) {
        Optional<ContentDefinition> definition = pageDefinition(projectId, payload);
        if (definition.isEmpty()) {
            return new RuleOutcome(List.of(), List.of(), List.of(), payload, Set.of());
        }
        return engine(projectId).evaluatePage(definition.get(), payload, pageContentValidation.sectionTemplates(projectId),
                new RuleEngine.Request(scope, locales, contexts.draft(projectId, pageUuid, AssetType.PAGE, payload, null)));
    }

    /**
     * The rule outcome of a record's or property set's values in {@code scope} over the drafts. Findings are rooted at
     * {@code content}.
     */
    public RuleOutcome content(
            long projectId,
            UUID assetUuid,
            AssetType type,
            ContentDefinition definition,
            JsonNode payload,
            JsonNode content,
            RuleScope scope,
            Collection<String> locales) {
        String kind = type == AssetType.RECORD ? "record" : type == AssetType.GLOBAL_SET ? "global" : "section";
        SectionTemplateLookup sections = type == AssetType.GLOBAL_SET ? null : pageContentValidation.sectionTemplates(projectId);
        return engine(projectId).evaluate(definition, content, kind, "content", sections,
                new RuleEngine.Request(scope, locales, contexts.draft(projectId, assetUuid, type, payload, null)));
    }

    // ------------------------------------------------------------------
    // Sessions (M33.6, M33.7)
    // ------------------------------------------------------------------

    /** A session evaluating many assets of {@code projectId}; use it within one transaction. */
    public Session session(long projectId) {
        return new Session(projectId);
    }

    /**
     * Evaluates many assets of one project (a release, M33.6): the template hierarchy, the section templates, the
     * validator and each definition are resolved once, however many assets it evaluates. Not thread-safe.
     */
    public final class Session {

        private final long projectId;
        private TemplateHierarchy hierarchy;
        private SectionTemplateLookup sections;
        private PaginationSourceLookup sources;
        private RuleEngine engine;
        private final Map<UUID, Optional<ContentDefinition>> pageDefinitions = new HashMap<>();
        private final Map<UUID, Optional<ContentDefinition>> datasetDefinitions = new HashMap<>();
        private final Map<String, ContentDefinition> compiled = new HashMap<>();

        private Session(long projectId) {
            this.projectId = projectId;
        }

        /** The definition an asset's payload is checked against: its template, dataset or own schema. */
        public Optional<ContentDefinition> definition(AssetType type, JsonNode payload) {
            if (payload == null) {
                return Optional.empty();
            }
            return switch (type) {
                case PAGE -> parse(payload.path("templateRef")).flatMap(template -> pageDefinitions.computeIfAbsent(
                        template, uuid -> hierarchy().effectiveDefinition(uuid).map(EffectiveDefinition::definition)));
                case RECORD -> parse(payload.path("datasetRef")).flatMap(dataset -> datasetDefinitions.computeIfAbsent(
                        dataset, uuid -> sources().datasetSchema(uuid)));
                case GLOBAL_SET -> Optional.of(compiled.computeIfAbsent(
                        payload.path("contentDefinition").asText(""), cdl -> cdlCompiler.compile(cdl).definition()));
                default -> Optional.empty();
            };
        }

        /**
         * The outcome of {@code payload} (a page, record or property set) in {@code scope}; its {@code content} is the
         * whole payload with the fills applied.
         */
        public RuleOutcome evaluate(
                AssetType type,
                ContentDefinition definition,
                JsonNode payload,
                RuleScope scope,
                Collection<String> locales,
                RuleContextProvider provider) {
            RuleEngine.Request request = new RuleEngine.Request(scope, locales, provider);
            if (type == AssetType.PAGE) {
                return engine().evaluatePage(definition, payload, sections(), request);
            }
            String kind = type == AssetType.RECORD ? "record" : "global";
            RuleOutcome outcome = engine().evaluate(definition, payload.path("content"), kind, "content",
                    type == AssetType.RECORD ? sections() : null, request);
            ObjectNode whole = payload.deepCopy();
            whole.set("content", outcome.content());
            return new RuleOutcome(outcome.findings(), outcome.fills(), outcome.fieldStates(), whole, outcome.refTargets());
        }

        private static Optional<UUID> parse(JsonNode ref) {
            try {
                return Optional.of(UUID.fromString(ref.asText("")));
            } catch (IllegalArgumentException e) {
                return Optional.empty();
            }
        }

        private TemplateHierarchy hierarchy() {
            if (hierarchy == null) {
                hierarchy = hierarchies.live(projectId);
            }
            return hierarchy;
        }

        private SectionTemplateLookup sections() {
            if (sections == null) {
                sections = pageContentValidation.sectionTemplates(projectId);
            }
            return sections;
        }

        private PaginationSourceLookup sources() {
            if (sources == null) {
                sources = recordDatasets.paginationSources(projectId);
            }
            return sources;
        }

        private RuleEngine engine() {
            if (engine == null) {
                engine = ContentRules.this.engine(projectId);
            }
            return engine;
        }
    }

    // ------------------------------------------------------------------
    // Edit scope (M33.5)
    // ------------------------------------------------------------------

    /** What an editor evaluates live: a page (with its bodies), a section on its own, a record or a property set. */
    public enum EditKind { PAGE, SECTION, RECORD, GLOBAL_SET }

    /**
     * An unsaved value to evaluate in the {@code edit} scope. The definition comes from {@code templateUid} (page or
     * section template), {@code datasetUid} or {@code globalSetUid}; when that is absent, from the stored asset
     * {@code assetUuid}. {@code locale} limits evaluation to that language (and the default language); {@code null}
     * evaluates every project language.
     */
    public record EditRequest(
            EditKind kind,
            UUID assetUuid,
            String templateUid,
            String datasetUid,
            String globalSetUid,
            JsonNode content,
            JsonNode bodies,
            String locale) {}

    /**
     * The {@code edit} outcome of an unsaved value (M33.5): findings of every level, the fills and the field states.
     * Reads drafts; stores nothing. A section evaluated on its own has no {@code section.page}; evaluate its page to
     * get it.
     *
     * @throws SfException {@code 400} for a missing kind or an undeclared locale, {@code 404} when the definition's
     *     asset doesn't exist
     */
    @Transactional(readOnly = true)
    public RuleOutcome edit(long projectId, EditRequest request) {
        if (request.kind() == null) {
            throw new SfException(ProblemFactory.badRequest("kind is required.", "kind"));
        }
        Collection<String> locales = editLocales(projectId, request.locale());
        ObjectNode content = request.content() != null && request.content().isObject()
                ? (ObjectNode) request.content().deepCopy()
                : JsonNodeFactory.instance.objectNode();
        ObjectNode payload = JsonNodeFactory.instance.objectNode();
        switch (request.kind()) {
            case PAGE -> {
                UUID template = request.templateUid() != null
                        ? uuidOf(projectId, AssetType.PAGE_TEMPLATE, request.templateUid(), "Page template")
                        : uuidOf(storedPayload(projectId, request.assetUuid(), AssetType.PAGE, "Page").path("templateRef"),
                                "Page template");
                payload.put("templateRef", template.toString());
                payload.set("content", content);
                payload.set("bodies", request.bodies() != null && request.bodies().isObject()
                        ? request.bodies().deepCopy()
                        : JsonNodeFactory.instance.objectNode());
                ContentDefinition definition = pageDefinition(projectId, payload)
                        .orElseThrow(() -> new SfException(ProblemFactory.notFound("Page template not found.")));
                return engine(projectId).evaluatePage(definition, payload, pageContentValidation.sectionTemplates(projectId),
                        new RuleEngine.Request(RuleScope.EDIT, locales,
                                contexts.draft(projectId, request.assetUuid(), AssetType.PAGE, payload, null)));
            }
            case SECTION -> {
                UUID template = uuidOf(projectId, AssetType.SECTION_TEMPLATE, request.templateUid(), "Section template");
                SectionTemplateLookup sections = pageContentValidation.sectionTemplates(projectId);
                ContentDefinition definition = sections.find(template.toString())
                        .map(SectionTemplateLookup.SectionTemplate::definition)
                        .orElseThrow(() -> new SfException(ProblemFactory.notFound("Section template not found.")));
                return engine(projectId).evaluate(definition, content, "section", "content", sections,
                        new RuleEngine.Request(RuleScope.EDIT, locales,
                                contexts.draft(projectId, request.assetUuid(), AssetType.PAGE, null, null)));
            }
            case RECORD -> {
                UUID dataset = request.datasetUid() != null
                        ? uuidOf(projectId, AssetType.DATASET, request.datasetUid(), "Dataset")
                        : uuidOf(storedPayload(projectId, request.assetUuid(), AssetType.RECORD, "Record").path("datasetRef"),
                                "Dataset");
                ContentDefinition definition = compile(storedPayload(projectId, dataset, AssetType.DATASET, "Dataset"));
                payload.put("datasetRef", dataset.toString());
                payload.set("content", content);
                return content(projectId, request.assetUuid(), AssetType.RECORD, definition, payload, content,
                        RuleScope.EDIT, locales);
            }
            case GLOBAL_SET -> {
                UUID set = request.globalSetUid() != null
                        ? uuidOf(projectId, AssetType.GLOBAL_SET, request.globalSetUid(), "Property set")
                        : request.assetUuid();
                ContentDefinition definition = compile(storedPayload(projectId, set, AssetType.GLOBAL_SET, "Property set"));
                payload.set("content", content);
                return content(projectId, set, AssetType.GLOBAL_SET, definition, payload, content, RuleScope.EDIT, locales);
            }
            default -> throw new IllegalStateException();
        }
    }

    /** The languages an edit evaluation covers: the editing language and the default one, or all. */
    private Collection<String> editLocales(long projectId, String locale) {
        if (locale == null || locale.isBlank()) {
            return null;
        }
        LocalizationContext localization = LocalizationContext.of(projectLocales.forProject(projectId));
        if (!localization.localized()) {
            return null;
        }
        if (!localization.declares(locale)) {
            throw new SfException(ProblemFactory.badRequest("Unknown locale '" + locale + "'.", "locale"));
        }
        Set<String> locales = new java.util.LinkedHashSet<>();
        locales.add(locale);
        if (localization.defaultLocale() != null) {
            locales.add(localization.defaultLocale());
        }
        return locales;
    }

    private ContentDefinition compile(JsonNode payload) {
        return cdlCompiler.compile(payload.path("contentDefinition").asText("")).definition();
    }

    private UUID uuidOf(long projectId, AssetType type, String uid, String what) {
        if (uid == null || uid.isBlank()) {
            throw new SfException(ProblemFactory.badRequest(what + " uid is required.", "uid"));
        }
        return assetRepository.findByProjectIdAndAssetTypeAndUid(projectId, type, uid)
                .map(Asset::getUuid)
                .orElseThrow(() -> new SfException(ProblemFactory.notFound(what + " '" + uid + "' not found.")));
    }

    private static UUID uuidOf(JsonNode ref, String what) {
        try {
            return UUID.fromString(ref.asText(""));
        } catch (IllegalArgumentException e) {
            throw new SfException(ProblemFactory.notFound(what + " not found."));
        }
    }

    /** The current payload of the live asset {@code uuid} of {@code type}, or {@code 404}. */
    private JsonNode storedPayload(long projectId, UUID uuid, AssetType type, String what) {
        if (uuid == null) {
            throw new SfException(ProblemFactory.badRequest("assetUuid or a definition uid is required.", "assetUuid"));
        }
        return assetRepository.findByProjectIdAndUuid(projectId, uuid)
                .filter(asset -> asset.getAssetType() == type)
                .flatMap(asset -> versionRepository.findByAssetIdAndValidToRevisionIsNull(asset.getId()))
                .filter(version -> !version.isDeleted())
                .map(AssetVersion::getPayload)
                .orElseThrow(() -> new SfException(ProblemFactory.notFound(what + " not found.")));
    }

    // ------------------------------------------------------------------
    // Save gate
    // ------------------------------------------------------------------

    /**
     * Runs the save gate on a page payload about to be stored and returns the payload to store.
     *
     * @param stored the page's stored payload, {@code null} on create
     */
    public ObjectNode savePage(long projectId, UUID pageUuid, JsonNode stored, ObjectNode incoming) {
        if (pageDefinition(projectId, incoming).isEmpty()) {
            return incoming;
        }
        List<ContentIssue> notes = new ArrayList<>();
        ObjectNode working = incoming.deepCopy();
        if (stored != null && stored.isObject()) {
            enforceReadOnly(page(projectId, pageUuid, stored, RuleScope.SAVE, null), stored, working, notes);
        }
        JsonNode typed = working.deepCopy();
        RuleOutcome outcome = page(projectId, pageUuid, working, RuleScope.SAVE, null);
        noteComputed(outcome, typed, notes);
        gate(outcome, notes, "Page");
        return (ObjectNode) outcome.content();
    }

    /**
     * Runs the save gate on a record's or property set's values about to be stored and returns the values to store.
     *
     * @param storedContent the stored values, {@code null} on create
     */
    public JsonNode saveContent(
            long projectId,
            UUID assetUuid,
            AssetType type,
            ContentDefinition definition,
            JsonNode payload,
            JsonNode storedContent,
            JsonNode incomingContent) {
        if (definition == null) {
            return incomingContent;
        }
        List<ContentIssue> notes = new ArrayList<>();
        ObjectNode working = JsonNodeFactory.instance.objectNode();
        working.set("content", incomingContent == null ? JsonNodeFactory.instance.objectNode() : incomingContent.deepCopy());
        if (storedContent != null && storedContent.isObject()) {
            ObjectNode storedRoot = JsonNodeFactory.instance.objectNode().set("content", storedContent);
            RuleOutcome onStored = content(projectId, assetUuid, type, definition, payload, storedContent, RuleScope.SAVE, null);
            enforceReadOnly(onStored, storedRoot, working, notes);
        }
        JsonNode typed = working.deepCopy();
        RuleOutcome outcome = content(projectId, assetUuid, type, definition, payload, working.get("content"), RuleScope.SAVE, null);
        noteComputed(outcome, typed, notes);
        gate(outcome, notes, type == AssetType.RECORD ? "Record" : "Property set");
        return outcome.content();
    }

    /**
     * Restores every field whose {@code readOnlyWhen} holds on the stored version, noting each ignored change. A
     * {@code mode always} fill's target is read-only too, but the fill recomputes it ({@link #noteComputed}).
     */
    private static void enforceReadOnly(RuleOutcome onStored, JsonNode storedRoot, ObjectNode working, List<ContentIssue> notes) {
        for (FieldState state : onStored.fieldStates()) {
            if (!state.readOnly() || state.computed()) {
                continue;
            }
            JsonNode storedValue = JsonPaths.get(storedRoot, state.path(), state.locale());
            JsonNode incomingValue = JsonPaths.get(working, state.path(), state.locale());
            if (sameValue(storedValue, incomingValue)) {
                continue;
            }
            if (JsonPaths.set(working, state.path(), state.locale(), storedValue == null ? null : storedValue.deepCopy())) {
                notes.add(readOnlyNote(state.path(), state.locale()));
            }
        }
    }

    /** A value typed into a {@code mode always} field that differs from the computed one is replaced by it: note it. */
    private static void noteComputed(RuleOutcome outcome, JsonNode beforeFills, List<ContentIssue> notes) {
        Set<String> noted = new HashSet<>();
        notes.forEach(note -> noted.add(note.path() + "|" + note.locale()));
        for (RuleFill fill : outcome.fills()) {
            if (fill.mode() != FillMode.ALWAYS || !noted.add(fill.path() + "|" + fill.locale())) {
                continue;
            }
            JsonNode typed = JsonPaths.get(beforeFills, fill.path(), fill.locale());
            if (!ExpressionValues.isEmpty(typed) && !sameValue(typed, fill.value())) {
                notes.add(readOnlyNote(fill.path(), fill.locale()));
            }
        }
    }

    private static boolean sameValue(JsonNode a, JsonNode b) {
        boolean aNull = a == null || a.isNull() || a.isMissingNode();
        boolean bNull = b == null || b.isNull() || b.isMissingNode();
        return aNull || bNull ? aNull == bNull : a.equals(b);
    }

    private static ContentIssue readOnlyNote(String path, String locale) {
        return new ContentIssue(path, RuleEngine.CODE_READ_ONLY, Severity.INFO,
                "'" + path + "' is read-only here: your change was not saved.",
                ContentIssue.Kind.COMPLETENESS, RuleEngine.CODE_READ_ONLY, Set.of(RuleScope.SAVE, RuleScope.EDIT), Map.of(),
                locale, null);
    }

    /** Rejects a save that a save-scope error blocks; otherwise hands the save's findings to {@link SaveFindings}. */
    private static void gate(RuleOutcome outcome, List<ContentIssue> notes, String what) {
        List<ContentIssue> ruleFindings = outcome.findings().stream()
                .filter(f -> f.kind() == ContentIssue.Kind.COMPLETENESS)
                .toList();
        List<ContentIssue> blocking = ruleFindings.stream().filter(f -> f.blocks(RuleScope.SAVE)).toList();
        List<ContentIssue> all = new ArrayList<>(notes);
        all.addAll(ruleFindings);
        if (!blocking.isEmpty()) {
            ContentIssue first = blocking.get(0);
            String detail = what + " can't be saved: " + (first.path().isEmpty() ? "" : first.path() + " — ") + first.message()
                    + (blocking.size() > 1 ? " (+" + (blocking.size() - 1) + " more)" : "");
            throw new SfException(ProblemFactory.unprocessableEntity(detail, "issues", all));
        }
        SaveFindings.add(all);
    }
}
