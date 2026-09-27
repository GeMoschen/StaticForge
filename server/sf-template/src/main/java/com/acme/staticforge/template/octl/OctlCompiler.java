package com.acme.staticforge.template.octl;

import com.acme.staticforge.template.content.ContentDefinition;
import com.acme.staticforge.template.content.EditorDefinition;
import com.acme.staticforge.template.content.EditorType;
import com.acme.staticforge.template.content.EffectiveDefinition;
import com.acme.staticforge.template.diagnostic.Diagnostic;
import com.acme.staticforge.template.diagnostic.DiagnosticCodes;
import com.acme.staticforge.template.diagnostic.Severity;
import com.acme.staticforge.template.query.DatasetQuery;
import com.acme.staticforge.template.query.DatasetQueryParser;
import com.acme.staticforge.template.query.RecordView;
import com.acme.staticforge.template.render.Filters;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.IdentityHashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;

/**
 * OCTL compiler pipeline (spec §16.9, §16.10): {@code source → lex → parse → resolve refs →
 * (CompiledTemplate, Diagnostics[])}. Dependency-free (no Spring); a single instance is
 * cheap and safe to reuse. Reference resolution turns {@code assetType:uid} into UUIDs at
 * compile time; scope/name validation against a {@link ContentDefinition} yields the §16.11
 * diagnostics. Passing a {@code null} definition skips the name/editor checks (used by the
 * validate endpoint before the template's content definition is known).
 */
public final class OctlCompiler {

    private static final String HASH_ALGORITHM = "SHA-256";

    /** How many ancestors a page template may have (M20): {@code SF-TPL-0155} beyond. */
    public static final int MAX_INHERITANCE_DEPTH = 8;

    /** The read-only root of a paginated page's current slice and page links (M21.3.1). */
    public static final String PAGINATION_ROOT = "CMS_PAGINATION";

    /**
     * The reserved iterable of the project's content locales (M24.3.1):
     * {@code $CMS_FOR(l : CMS_LOCALES)$} renders a language switcher from
     * {@code {code, language, label, current, href}} items.
     */
    public static final String LOCALES_ROOT = "CMS_LOCALES";

    /**
     * The render's {@code $CMS_META} values as a read-only expression root (M30.2.2): {@code $CMS_META(noIndex)$}
     * prints a value, {@code $CMS_IF(CMS_META.noIndex)$} tests it — a template writes the robots meta only for a page
     * that asks search engines not to index it.
     */
    public static final String META_ROOT = "CMS_META";

    /**
     * The per-render position names of a dataset record template (M25): the record's place in the list a
     * record set renders — {@code _index} (0-based), {@code _first}, {@code _last} and {@code _count}. Known at
     * compile time, bound by the renderer.
     */
    public static final Set<String> RECORD_POSITION_FIELDS = Set.of("_index", "_first", "_last", "_count");

    /** The {@code _meta} object every record item carries ({@code uid}, {@code displayName}). */
    private static final String RECORD_META_OBJECT = "_meta";

    private static final String INHERITANCE_IS_FOR_PAGE_TEMPLATES =
            "it renders on its own, inheritance is for page templates";

    /** The {@code assetType:uid} prefix of a dataset loop source (M19.3.2). */
    private static final String DATASET_PREFIX = "dataset";

    /** The {@code assetType:uid} prefix of a single record (M19.3.2). */
    private static final String RECORD_PREFIX = "record";

    /**
     * The {@code assetType:uid} prefix of a record set (M25.2.2, epic decision 1): {@code $CMS_VALUE(recordset:uid)$}
     * renders the set through its dataset's record template, {@code $CMS_FOR(x : recordset:uid, …)$} loops it.
     */
    public static final String RECORD_SET_PREFIX = "recordset";

    /** A text media file has no editors and no bodies: every bare name is unknown. */
    private static final ContentDefinition NO_EDITORS = new ContentDefinition(List.of(), List.of());

    /** Filters after which a JS/JSON value can no longer break out of a string literal. */
    private static final Set<String> TEXT_MEDIA_ESCAPING_FILTERS = Set.of("js", "json", "attr", "url", "html", "raw");

    /** Creates a compiler. Stateless; a single instance may compile any number of templates. */
    public OctlCompiler() {}

    /**
     * Compiles OCTL source into a best-effort {@link CompiledTemplate} and its diagnostics,
     * without a content definition (name/editor checks and reference edge recording are
     * skipped for refs; an unresolvable reference is still reported when a resolver is
     * supplied).
     */
    public OctlResult compile(String source, String channelKey, ReferenceResolver references) {
        return compile(source, channelKey, references, null);
    }

    /**
     * Compiles OCTL source with a content definition for scope/name validation.
     *
     * @param references the {@code assetType:uid -> uuid} resolver, may be {@code null} to
     *                   skip reference resolution
     * @param contentDef the template's content definition, may be {@code null} to skip
     *                   name/editor checks
     */
    public OctlResult compile(
            String source, String channelKey, ReferenceResolver references, ContentDefinition contentDef) {
        return compile(source, channelKey, references, contentDef, (TextMedia) null);
    }

    /**
     * Compiles the source of a processed text media file (CSS, JS, JSON, SVG, …; M18.2.1). The file
     * belongs to no page, so on top of the template checks (against a definition with no editors,
     * which makes every bare name an unknown editor):
     *
     * <ul>
     *   <li>{@code $CMS_BODY}, {@code $CMS_INCLUDE}, the leaf form of {@code $CMS_NAVIGATION} (which
     *       emits HTML) and {@code CMS_PAGE} are {@code SF-TPL-0121} errors;
     *   <li>every {@code $$} outside a {@code $CMS_COMMENT$} block is an {@code SF-TPL-0320} warning,
     *       because the output then contains a single {@code $};
     *   <li>when {@code scriptLike} (JS/JSON), a {@code $CMS_VALUE} without an escaping filter is an
     *       {@code SF-TPL-0321} warning.
     * </ul>
     *
     * @param scriptLike whether the file's MIME type is JavaScript or JSON
     */
    public OctlResult compileTextMedia(
            String source, String channelKey, ReferenceResolver references, boolean scriptLike) {
        return compile(source, channelKey, references, NO_EDITORS, new TextMedia(scriptLike));
    }

    /**
     * Compiles a dataset's per-channel record template (M25): the markup one record renders with when a record
     * set is rendered. The record is the local scope — the dataset's fields are top-level names like a section
     * template's editors, next to the record meta fields ({@link RecordView#META_FIELDS},
     * {@code _meta}) and the per-render position ({@link #RECORD_POSITION_FIELDS}); any other bare name is the
     * usual {@code SF-TPL-0103}. On top of the template checks:
     *
     * <ul>
     *   <li>{@code $CMS_EXTENDS}, {@code $CMS_BLOCK}, {@code $CMS_PARENT} and {@code $CMS_BODY} are
     *       {@code SF-TPL-0122} errors: a record template is standalone and has no bodies;
     *   <li>{@code SF-TPL-0310} (field declared but unused) is not raised — a record template shows the fields it
     *       wants.
     * </ul>
     *
     * @param datasetDefinition the dataset's schema, may be {@code null} to skip name checks
     */
    public OctlResult compileRecordTemplate(
            String source, String channelKey, ReferenceResolver references, ContentDefinition datasetDefinition) {
        String channel = channelKey == null ? "html" : channelKey;
        Link link = link(new LayerSource(null, null, source, datasetDefinition), channel, references, null, true,
                new Inheritance(null, null, null, null), new ArrayList<>());
        return new OctlResult(link.template(), link.diagnostics());
    }

    /**
     * Compiles a page template's channel source against its inheritance chain (M20): the ancestors its
     * {@code $CMS_EXTENDS} names are loaded through {@code parents}, compiled and linked, and names are
     * checked against the effective definition (own + inherited). A template that doesn't extend compiles
     * exactly as {@link #compile(String, String, ReferenceResolver, ContentDefinition)}.
     *
     * @param parents the ancestor loader; {@code null} reports a template that extends with {@code SF-TPL-0161}
     * @param ownDefinition the template's own content definition, may be {@code null} to skip name checks
     */
    public OctlResult compile(
            String source,
            String channelKey,
            ReferenceResolver references,
            ParentTemplateLoader parents,
            ContentDefinition ownDefinition) {
        return compile(source, channelKey, references, ownDefinition, Inheritance.of(parents));
    }

    /**
     * {@link #compile(String, String, ReferenceResolver, ParentTemplateLoader, ContentDefinition)} with the
     * compiled template's identity and an ancestor memo shared by related compiles.
     *
     * <p>The result's {@link CompiledTemplate#hash()} covers every layer of the chain (channel, sources,
     * ancestor UUIDs), so it is the key a compile cache must use for a template that extends: a key on the
     * template's own version alone would serve a stale parent.
     */
    public OctlResult compile(
            String source,
            String channelKey,
            ReferenceResolver references,
            ContentDefinition ownDefinition,
            Inheritance inheritance) {
        Inheritance scope = inheritance == null ? new Inheritance(null, null, null, null) : inheritance;
        return compile(new LayerSource(scope.templateUuid(), scope.templateUid(), source, ownDefinition),
                channelKey, references, null, scope);
    }

    private OctlResult compile(
            String source,
            String channelKey,
            ReferenceResolver references,
            ContentDefinition contentDef,
            TextMedia textMedia) {
        return compile(new LayerSource(null, null, source, contentDef), channelKey, references, textMedia,
                new Inheritance(null, null, null, null));
    }

    private OctlResult compile(
            LayerSource layer, String channelKey, ReferenceResolver references, TextMedia textMedia, Inheritance inheritance) {
        String channel = channelKey == null ? "html" : channelKey;
        Link link = link(layer, channel, references, textMedia, false, inheritance, new ArrayList<>());
        return new OctlResult(link.template(), link.diagnostics());
    }

    // ------------------------------------------------------------------
    // Chain linking (M20)
    // ------------------------------------------------------------------

    /** One template of a chain: identity (unknown for an unsaved entry template), source and own CDL. */
    private record LayerSource(UUID uuid, String uid, String source, ContentDefinition ownDefinition) {

        LayerSource {
            source = source == null ? "" : source;
        }

        String label() {
            return uid != null ? uid : "this template";
        }
    }

    /**
     * A template compiled with its chain: the result, the own definitions along the chain root first (for
     * descendants' effective definitions), the names used anywhere along it and its number of ancestors.
     * {@code cycle} describes an inheritance cycle the chain ran into; {@code truncated} marks a chain whose
     * loading stopped at the depth cap. Neither kind is memoized: both depend on where the compile entered.
     */
    record Link(
            UUID uuid,
            String uid,
            CompiledTemplate template,
            List<Diagnostic> diagnostics,
            List<EffectiveDefinition.Layer> definitions,
            Set<String> usedEditors,
            Set<String> usedBodies,
            int depth,
            String cycle,
            boolean truncated) {

        boolean hasErrors() {
            return diagnostics.stream().anyMatch(d -> d.severity() == Severity.ERROR);
        }
    }

    /**
     * Compiles {@code layer} and, when it extends, its chain. {@code path} holds the descendants that led
     * here (entry template first) for cycle detection by UUID and the depth cap. A {@code recordTemplate}
     * (M25) never extends: its inheritance instructions are reported by the validation walk instead.
     */
    private Link link(
            LayerSource layer,
            String channel,
            ReferenceResolver references,
            TextMedia textMedia,
            boolean recordTemplate,
            Inheritance inheritance,
            List<LayerSource> path) {
        String text = layer.source();
        OctlLexer.LexResult lexed = new OctlLexer().lex(text);
        OctlParser.ParseResult parsed = new OctlParser(lexed.tokens()).parse();
        List<OctlNode> nodes = parsed.nodes();

        List<Diagnostic> diagnostics = new ArrayList<>(lexed.diagnostics());
        diagnostics.addAll(parsed.diagnostics());
        OctlNode.Extends extendsNode = recordTemplate ? null : InheritanceRules.check(nodes, diagnostics);
        boolean extending = !recordTemplate && nodes.stream().anyMatch(OctlNode.Extends.class::isInstance);
        if (textMedia != null && extending) {
            nodes.stream()
                    .filter(OctlNode.Extends.class::isInstance)
                    .map(OctlNode.Extends.class::cast)
                    .forEach(e -> notInTextMedia("$CMS_EXTENDS", e.line(), e.col(), diagnostics));
            extendsNode = null;
        }

        Link parent = null;
        UUID parentUuid = null;
        String cycle = null;
        boolean truncated = false;
        int depth = 0;
        if (extendsNode != null) {
            Accessor target = extendsNode.accessor();
            // An unresolvable target is reported as SF-TPL-0110 by the validation walk below.
            parentUuid = references == null ? null : references.resolve(target.assetType(), target.uid()).orElse(null);
            UUID uuid = inheritance.loader() == null ? null : parentUuid;
            if (inheritance.loader() == null || references == null) {
                diagnostics.add(Diagnostic.error(
                        DiagnosticCodes.OCTL_PARENT_UNAVAILABLE,
                        "Parent template " + target.referenceKey() + " can't be loaded in this context, so inherited"
                                + " blocks and editors aren't checked",
                        extendsNode.line(), extendsNode.col()));
            } else if (uuid != null && (uuid.equals(layer.uuid()) || path.stream().anyMatch(p -> uuid.equals(p.uuid())))) {
                cycle = cycleDescription(path, layer, target.uid());
            } else if (uuid != null && path.size() >= MAX_INHERITANCE_DEPTH) {
                truncated = true;
                depth = MAX_INHERITANCE_DEPTH + 1;
            } else if (uuid != null) {
                List<LayerSource> below = new ArrayList<>(path);
                below.add(layer);
                parent = loadParent(uuid, target, extendsNode, channel, references, inheritance, below, diagnostics);
                if (parent != null) {
                    cycle = parent.cycle();
                    truncated = parent.truncated();
                    depth = parent.depth() + 1;
                }
            }
            if (cycle != null) {
                diagnostics.add(Diagnostic.error(
                        DiagnosticCodes.OCTL_INHERITANCE_CYCLE,
                        "Inheritance cycle: " + cycle, extendsNode.line(), extendsNode.col()));
                parent = null;
            } else if (depth > MAX_INHERITANCE_DEPTH) {
                diagnostics.add(Diagnostic.error(
                        DiagnosticCodes.OCTL_INHERITANCE_DEPTH,
                        "Inheritance chain is deeper than " + MAX_INHERITANCE_DEPTH + " templates",
                        extendsNode.line(), extendsNode.col()));
                parent = null;
            } else if (parent != null && parent.hasErrors()) {
                Diagnostic first = parent.diagnostics().stream()
                        .filter(d -> d.severity() == Severity.ERROR)
                        .findFirst()
                        .orElseThrow();
                diagnostics.add(Diagnostic.error(
                        DiagnosticCodes.OCTL_ANCESTOR_INVALID,
                        "Parent template '" + parent.uid() + "' has compile errors for this channel: " + first.code()
                                + " " + first.message()
                                + (first.line() > 0 ? " (line " + first.line() + ", col " + first.column() + ")" : ""),
                        extendsNode.line(), extendsNode.col()));
            }
        }

        // Names are checked against the effective definition: own + inherited, root first. A template that
        // extends but whose chain didn't link can't tell inherited names from typos, so it skips the checks.
        boolean namesUnknown = extending && parent == null;
        List<EffectiveDefinition.Layer> definitions = new ArrayList<>();
        if (parent != null) {
            definitions.addAll(parent.definitions());
        } else if (!extending && path.isEmpty() && inheritance.inheritedDefinitions() != null) {
            definitions.addAll(inheritance.inheritedDefinitions());
        }
        definitions.add(new EffectiveDefinition.Layer(layer.label(), layer.ownDefinition()));
        EffectiveDefinition effective = null;
        if (layer.ownDefinition() != null && !namesUnknown) {
            effective = EffectiveDefinition.merge(definitions);
            diagnostics.addAll(effective.diagnostics());
        }

        Map<String, UUID> refMap = new LinkedHashMap<>();
        ValidateCtx ctx = new ValidateCtx(
                references, effective == null ? null : effective.definition(), refMap, diagnostics, textMedia,
                recordTemplate, namesUnknown);
        validate(nodes, new HashSet<>(), ctx);

        Set<String> usedEditors = new HashSet<>(ctx.usedEditors);
        Set<String> usedBodies = new HashSet<>(ctx.usedBodies);
        if (parent != null) {
            usedEditors.addAll(parent.usedEditors());
            usedBodies.addAll(parent.usedBodies());
        }
        if (effective != null && !recordTemplate) {
            emitDeclaredNeverUsed(layer.ownDefinition(), effective, usedEditors, usedBodies, diagnostics);
        }
        if (textMedia != null) {
            warnDollarEscapes(lexed, diagnostics);
        }

        Map<String, UUID> allReferences = new LinkedHashMap<>();
        Map<OctlNode.For, DatasetQuery> allQueries = new IdentityHashMap<>();
        CompiledTemplate.Chain chain;
        String hash;
        if (parent != null) {
            CompiledTemplate linked = parent.template();
            Map<String, List<List<OctlNode>>> table = new LinkedHashMap<>(linked.blocks());
            InheritanceRules.blocks(nodes).forEach((name, body) -> {
                List<List<OctlNode>> blockDefinitions = new ArrayList<>();
                blockDefinitions.add(body);
                blockDefinitions.addAll(linked.blocks().getOrDefault(name, List.of()));
                table.put(name, blockDefinitions);
            });
            for (OctlNode.Block override : InheritanceRules.topLevelBlocks(nodes)) {
                if (!linked.blocks().containsKey(override.name())) {
                    String suggestion = InheritanceRules.suggestion(override.name(), linked.blocks().keySet());
                    diagnostics.add(Diagnostic.warning(
                            DiagnosticCodes.OCTL_UNKNOWN_BLOCK_OVERRIDE,
                            "Block '" + override.name() + "' is not defined by any ancestor, so it never renders"
                                    + (suggestion == null ? "" : " (did you mean '" + suggestion + "'?)"),
                            override.line(), override.col()));
                }
            }
            InheritanceRules.checkRecursion(table, diagnostics, extendsNode.line(), extendsNode.col());

            List<OctlNode> setup = new ArrayList<>(linked.setupNodes());
            setup.addAll(InheritanceRules.topLevelSets(nodes));
            List<CompiledTemplate.Ancestor> ancestors = new ArrayList<>();
            ancestors.add(new CompiledTemplate.Ancestor(parent.uuid(), parent.uid()));
            ancestors.addAll(linked.ancestors());

            allReferences.putAll(linked.references());
            allQueries.putAll(linked.datasetQueryMap());
            chain = new CompiledTemplate.Chain(linked.layoutNodes(), setup, table, ancestors, parentUuid, effective);
            hash = sha256(channel + '\u0000' + text + '\u0000' + parentUuid + '\u0000' + linked.hash());
        } else {
            chain = new CompiledTemplate.Chain(
                    nodes, List.of(), CompiledTemplate.Chain.standalone(nodes).blocks(), List.of(), parentUuid, effective);
            hash = sha256(channel + '\u0000' + text);
        }
        allReferences.putAll(refMap);
        allQueries.putAll(ctx.datasetQueries);

        CompiledTemplate template = new CompiledTemplate(
                channel,
                hash,
                nodes,
                allReferences,
                ReferenceUseCollector.collect(nodes, ctx.datasetQueries),
                allQueries,
                chain);
        return new Link(
                layer.uuid(), layer.label(), template, diagnostics, definitions, usedEditors, usedBodies, depth, cycle,
                truncated);
    }

    /**
     * Loads and links the parent {@code uuid}, reporting what makes it unusable ({@code SF-TPL-0161},
     * {@code 0158}) on the child; {@code null} when it can't be linked.
     */
    private Link loadParent(
            UUID uuid,
            Accessor target,
            OctlNode.Extends extendsNode,
            String channel,
            ReferenceResolver references,
            Inheritance inheritance,
            List<LayerSource> path,
            List<Diagnostic> diagnostics) {
        ChainCompileMemo memo = inheritance.memo();
        Link cached = memo == null ? null : memo.get(uuid, channel);
        if (cached != null) {
            return cached;
        }
        Optional<ParentSource> loaded = inheritance.loader().load(uuid, channel);
        if (loaded.isEmpty()) {
            diagnostics.add(Diagnostic.error(
                    DiagnosticCodes.OCTL_PARENT_UNAVAILABLE,
                    "Parent " + target.referenceKey() + " is not a live page template",
                    extendsNode.line(), extendsNode.col()));
            return null;
        }
        ParentSource source = loaded.get();
        if (source.channelSource() == null) {
            diagnostics.add(Diagnostic.error(
                    DiagnosticCodes.OCTL_ANCESTOR_MISSING_CHANNEL,
                    "Parent template '" + source.uid() + "' has no template for channel '" + channel + "';"
                            + " add one to it, or remove this channel from this template",
                    extendsNode.line(), extendsNode.col()));
            return null;
        }
        Link link = link(
                new LayerSource(source.uuid(), source.uid(), source.channelSource(), source.ownDefinition()),
                channel, references, null, false, inheritance, path);
        if (memo != null && link.cycle() == null && !link.truncated()) {
            memo.put(uuid, channel, link);
        }
        return link;
    }

    /** {@code a → b → a}: the part of the chain from the first occurrence of the repeated template. */
    private static String cycleDescription(List<LayerSource> path, LayerSource layer, String targetUid) {
        List<LayerSource> chain = new ArrayList<>(path);
        chain.add(layer);
        StringBuilder out = new StringBuilder();
        for (LayerSource step : chain) {
            out.append(step.label()).append(" → ");
        }
        return out.append(targetUid).toString();
    }

    /**
     * {@code SF-TPL-0201}/{@code 0310} for the template's own bodies and editors that nothing along the chain
     * renders or reads. Inherited ones are the ancestors' own concern, and a name that collided is already
     * an error.
     */
    private static void emitDeclaredNeverUsed(
            ContentDefinition own,
            EffectiveDefinition effective,
            Set<String> usedEditors,
            Set<String> usedBodies,
            List<Diagnostic> diagnostics) {
        for (var body : own.bodies()) {
            if (!effective.bodiesInheritedFrom().containsKey(body.name()) && !usedBodies.contains(body.name())) {
                diagnostics.add(Diagnostic.warning(
                        DiagnosticCodes.OCTL_BODY_NEVER_RENDERED,
                        "Body declared but never rendered: " + body.name(), 0, 0));
            }
        }
        for (EditorDefinition editor : own.editors()) {
            if (editor.isGroup() || editor.name().startsWith("_group_")
                    || effective.editorsInheritedFrom().containsKey(editor.name())) {
                continue;
            }
            if (!usedEditors.contains(editor.name())) {
                diagnostics.add(Diagnostic.warning(
                        DiagnosticCodes.OCTL_EDITOR_NEVER_USED,
                        "Editor declared but never used in this template: " + editor.name(), 0, 0));
            }
        }
    }

    // ------------------------------------------------------------------
    // Validation walk
    // ------------------------------------------------------------------

    private void validate(List<OctlNode> nodes, Set<String> shadowed, ValidateCtx ctx) {
        for (OctlNode node : nodes) {
            switch (node) {
                case OctlNode.Text t -> { /* nothing */ }
                case OctlNode.Value v -> {
                    checkAccessorRoot(v.accessor(), shadowed, v.line(), v.col(), ctx);
                    checkCrossAssetPath(v.accessor(), v.line(), v.col(), ctx);
                    checkFilters(v.filters(), v.line(), v.col(), ctx);
                    checkRaw(v.accessor(), v.filters(), v.line(), v.col(), ctx);
                    checkTextMediaEscaping(v, ctx);
                }
                case OctlNode.Ref r -> {
                    checkAccessorRoot(r.accessor(), shadowed, r.line(), r.col(), ctx);
                    checkRefHasUrl(r.accessor(), r.line(), r.col(), ctx);
                }
                case OctlNode.Body b -> {
                    if (ctx.recordTemplate) {
                        notInRecordTemplate("$CMS_BODY", "a record has values only, no bodies", b.line(), b.col(), ctx);
                    } else if (ctx.textMedia != null) {
                        notInTextMedia("$CMS_BODY", b.line(), b.col(), ctx.diagnostics);
                    } else {
                        checkBody(b, ctx);
                    }
                }
                case OctlNode.Include i -> {
                    if (ctx.textMedia != null) {
                        notInTextMedia("$CMS_INCLUDE", i.line(), i.col(), ctx.diagnostics);
                    } else {
                        resolveReference(i.accessor(), i.line(), i.col(), ctx);
                    }
                }
                case OctlNode.Navigation nav -> {
                    if (ctx.textMedia != null && nav.variable() == null) {
                        ctx.diagnostics.add(Diagnostic.error(
                                DiagnosticCodes.OCTL_NOT_ALLOWED_IN_TEXT_MEDIA,
                                "$CMS_NAVIGATION without 'as item' renders HTML and is not available in text media;"
                                        + " use $CMS_FOR(item : " + nav.accessor().referenceKey() + ")$ instead",
                                nav.line(),
                                nav.col()));
                    }
                    resolveReference(nav.accessor(), nav.line(), nav.col(), ctx);
                    checkNotPaginationRoot(nav.variable(), nav.line(), nav.col(), ctx);
                    if (nav.variable() != null) {
                        Set<String> inner = new HashSet<>(shadowed);
                        inner.add(nav.variable());
                        validate(nav.body(), inner, ctx);
                    }
                }
                case OctlNode.NavigationRecurse nr -> {
                    if (!shadowed.contains(nr.variable())) {
                        ctx.diagnostics.add(Diagnostic.error(
                                DiagnosticCodes.OCTL_UNKNOWN_NAV_VARIABLE,
                                "$CMS_NAVIGATION_RECURSE references an unbound variable: " + nr.variable(),
                                nr.line(),
                                nr.col()));
                    }
                }
                case OctlNode.If f -> {
                    for (OctlNode.Branch branch : f.branches()) {
                        validateExpr(branch.condition(), shadowed, ctx);
                        validate(branch.body(), shadowed, ctx);
                    }
                    validate(f.elseBody(), shadowed, ctx);
                }
                case OctlNode.For f -> {
                    checkAccessorRoot(f.accessor(), shadowed, f.line(), f.col(), ctx);
                    if (f.accessor().isAssetReference() && DATASET_PREFIX.equals(f.accessor().assetType())) {
                        compileDatasetLoop(f, shadowed, ctx);
                    } else if (isRecordSetSource(f.accessor())) {
                        compileRecordSetLoop(f, shadowed, ctx);
                    } else if (!f.accessor().isAssetReference() && !f.args().isEmpty()) {
                        compileReferenceLoop(f, shadowed, ctx);
                    }
                    checkNotPaginationRoot(f.variable(), f.line(), f.col(), ctx);
                    Set<String> inner = new HashSet<>(shadowed);
                    inner.add(f.variable());
                    validate(f.body(), inner, ctx);
                }
                case OctlNode.Set st -> {
                    validateExpr(st.expr(), shadowed, ctx);
                    checkNotPaginationRoot(st.name(), st.line(), st.col(), ctx);
                    shadowed.add(st.name());
                }
                case OctlNode.Meta m -> checkFilters(m.filters(), m.line(), m.col(), ctx);
                case OctlNode.Comment c -> { /* nothing */ }
                case OctlNode.Extends e -> {
                    if (ctx.recordTemplate) {
                        notInRecordTemplate("$CMS_EXTENDS", INHERITANCE_IS_FOR_PAGE_TEMPLATES, e.line(), e.col(), ctx);
                    } else if (InheritanceRules.PAGE_TEMPLATE_PREFIX.equals(e.accessor().assetType())
                            && e.accessor().uid() != null && !e.accessor().uid().isBlank()) {
                        resolveReference(e.accessor(), e.line(), e.col(), ctx);
                    }
                }
                case OctlNode.Block b -> {
                    if (ctx.recordTemplate) {
                        notInRecordTemplate("$CMS_BLOCK", INHERITANCE_IS_FOR_PAGE_TEMPLATES, b.line(), b.col(), ctx);
                    }
                    validate(b.body(), shadowed, ctx);
                }
                case OctlNode.Parent p -> {
                    // Otherwise placement is checked by InheritanceRules.
                    if (ctx.recordTemplate) {
                        notInRecordTemplate("$CMS_PARENT", INHERITANCE_IS_FOR_PAGE_TEMPLATES, p.line(), p.col(), ctx);
                    }
                }
            }
        }
    }

    private void validateExpr(Expr expr, Set<String> shadowed, ValidateCtx ctx) {
        switch (expr) {
            case Expr.Literal l -> { /* nothing */ }
            case Expr.Access a -> {
                checkAccessorRoot(a.accessor(), shadowed, 0, 0, ctx);
                checkFilters(a.filters(), 0, 0, ctx);
            }
            case Expr.Group g -> validateExpr(g.inner(), shadowed, ctx);
            case Expr.Not n -> validateExpr(n.operand(), shadowed, ctx);
            case Expr.And a -> {
                validateExpr(a.left(), shadowed, ctx);
                validateExpr(a.right(), shadowed, ctx);
            }
            case Expr.Or o -> {
                validateExpr(o.left(), shadowed, ctx);
                validateExpr(o.right(), shadowed, ctx);
            }
            case Expr.Cmp c -> {
                validateExpr(c.left(), shadowed, ctx);
                validateExpr(c.right(), shadowed, ctx);
            }
        }
    }

    private void checkFilters(List<FilterNode> filters, int line, int col, ValidateCtx ctx) {
        for (FilterNode f : filters) {
            if (!Filters.isKnown(f.name())) {
                ctx.diagnostics.add(Diagnostic.error(
                        DiagnosticCodes.OCTL_UNKNOWN_FILTER, "Unknown filter: " + f.name(), line, col));
            }
        }
    }

    private void checkAccessorRoot(Accessor accessor, Set<String> shadowed, int line, int col, ValidateCtx ctx) {
        if (accessor.isAssetReference()) {
            resolveReference(accessor, line, col, ctx);
            return;
        }
        if (ctx.contentDef == null) {
            return;
        }
        List<String> path = accessor.path();
        if (path.isEmpty()) {
            return;
        }
        String name = path.get(0);
        if (Accessor.GLOBAL_ROOT.equals(name) && !shadowed.contains(name)) {
            // A CMS_GLOBAL accessor with a set uid was already desugared into a global: reference
            // by the parser, so reaching here means the uid is missing (spec §16.5, M17.3.1).
            ctx.diagnostics.add(Diagnostic.error(
                    DiagnosticCodes.OCTL_GLOBAL_REFERENCE_MISUSE,
                    Accessor.GLOBAL_ROOT + " needs the property set to read, e.g. "
                            + Accessor.GLOBAL_ROOT + ".site.title",
                    line, col));
            return;
        }
        if (shadowed.contains(name)) {
            return;
        }
        if ("CMS_PAGE".equals(name) || PAGINATION_ROOT.equals(name)) {
            if (ctx.textMedia != null) {
                notInTextMedia(name, line, col, ctx.diagnostics);
            }
            return;
        }
        if (LOCALES_ROOT.equals(name) || META_ROOT.equals(name)) {
            // The language switcher and the meta values are available everywhere, including processed text media:
            // they read the render, not page structure.
            return;
        }
        if (ctx.contentDef.findEditor(name).isPresent()) {
            ctx.usedEditors.add(name);
            return;
        }
        if (ctx.recordTemplate && isRecordScopeName(name)) {
            return;
        }
        ctx.diagnostics.add(Diagnostic.error(
                DiagnosticCodes.OCTL_UNKNOWN_EDITOR, "Unknown editor name: " + name, line, col));
    }

    /**
     * {@code $CMS_VALUE(page:about)$} with no editor path would stringify the target's whole
     * value object — never useful output, almost always a forgotten {@code .editorName}.
     */
    private void checkCrossAssetPath(Accessor accessor, int line, int col, ValidateCtx ctx) {
        // A path-less record set is its rendered records (M25.2.2), not a value object to stringify.
        if (accessor.isAssetReference() && accessor.path().isEmpty() && !isRecordSetSource(accessor)) {
            ctx.diagnostics.add(Diagnostic.warning(
                    DiagnosticCodes.OCTL_CROSS_ASSET_VALUE_WITHOUT_PATH,
                    "Cross-asset value without an editor path: " + accessor.referenceKey()
                            + " (did you mean " + accessor.referenceKey() + ".editorName?)",
                    line, col));
        }
    }

    /**
     * A property set has no URL of its own, so {@code $CMS_REF(CMS_GLOBAL.site)$} (or the
     * equivalent {@code global:site}) can only ever render empty. The value path is what carries
     * the link — {@code $CMS_REF(CMS_GLOBAL.site.logo)$} refs the media the {@code logo} editor
     * holds — so the path-less form is a compile error rather than a silent blank (M17.3.1).
     * Records and datasets (M19.3.2) and record sets (M25.2.2) have no URL either.
     */
    private void checkRefHasUrl(Accessor accessor, int line, int col, ValidateCtx ctx) {
        if (!accessor.isAssetReference() || !accessor.path().isEmpty()) {
            return;
        }
        if (Accessor.GLOBAL_PREFIX.equals(accessor.assetType())) {
            ctx.diagnostics.add(Diagnostic.error(
                    DiagnosticCodes.OCTL_GLOBAL_REFERENCE_MISUSE,
                    "$CMS_REF on a property set needs the editor holding the link, e.g. "
                            + Accessor.GLOBAL_ROOT + "." + accessor.uid() + ".logo",
                    line, col));
        } else if (DATASET_PREFIX.equals(accessor.assetType()) || RECORD_PREFIX.equals(accessor.assetType())
                || RECORD_SET_PREFIX.equals(accessor.assetType())) {
            ctx.diagnostics.add(Diagnostic.error(
                    DiagnosticCodes.OCTL_GLOBAL_REFERENCE_MISUSE,
                    "$CMS_REF on a " + accessor.assetType() + " needs the editor holding the link, e.g. "
                            + accessor.referenceKey() + ".website: " + accessor.assetType() + "s have no URL",
                    line, col));
        }
    }

    /**
     * {@code $CMS_FOR(x : dataset:uid, where=…, sort=…, limit=…, offset=…, folder=…)$} (M19.3.2): the
     * arguments are parsed once here into the {@link com.acme.staticforge.template.query.DatasetQuery}
     * the renderer applies, so a bad argument is a compile-time {@code SF-TPL-0140} instead of a
     * render-time surprise. Accessors of {@code where} not rooted at the loop variable are ordinary
     * scope accessors and are checked like any other. With the dataset's schema (template save only)
     * the field names are checked too.
     */
    private void compileDatasetLoop(OctlNode.For loop, Set<String> shadowed, ValidateCtx ctx) {
        if (!loop.accessor().path().isEmpty()) {
            ctx.diagnostics.add(Diagnostic.error(
                    DiagnosticCodes.OCTL_DATASET_QUERY,
                    "A dataset loop iterates " + loop.accessor().referenceKey() + " itself; remove the path ."
                            + String.join(".", loop.accessor().path()),
                    loop.line(), loop.col()));
        }
        DatasetQuery query = compileLoopQuery(loop, shadowed, ctx);
        UUID dataset = ctx.refMap.get(loop.accessor().referenceKey());
        if (dataset != null && ctx.references != null) {
            checkLoopFields(loop, query, ctx.references.datasetDefinition(dataset), ctx);
        }
    }

    /**
     * {@code $CMS_FOR(x : recordset:uid, where=…, sort=…, limit=…, offset=…)$} (M25.2.2): the set's stored query
     * runs first, the loop's arguments narrow its result (epic decision 5) — compiled here exactly like a dataset
     * loop's, except that {@code folder} is {@code SF-TPL-0140} (the set is the scope). With the save-time resolver
     * the fields are checked against the set's dataset.
     */
    private void compileRecordSetLoop(OctlNode.For loop, Set<String> shadowed, ValidateCtx ctx) {
        DatasetQuery query = compileLoopQuery(loop, shadowed, ctx);
        rejectFolderOnSet(loop, query, loop.accessor().referenceKey(), ctx);
        UUID set = ctx.refMap.get(loop.accessor().referenceKey());
        if (set != null && ctx.references != null) {
            ReferenceResolver references = ctx.references;
            checkLoopFields(loop, query, references.recordSetDataset(set).flatMap(references::datasetDefinition), ctx);
        }
    }

    /**
     * {@code $CMS_FOR(x : editor, where=…, sort=…, limit=…, offset=…)$} over a local value (M25.2.2): loop arguments
     * only ever narrow a record set a {@code reference} editor points at, so they compile like a set loop's and the
     * renderer applies them when the value turns out to be a set (on any other list they are ignored, as before).
     * When the accessor is a {@code reference} editor declaring {@code dataset "uid"}, the fields are checked against
     * that dataset here; otherwise the renderer checks them against the referenced set's dataset.
     */
    private void compileReferenceLoop(OctlNode.For loop, Set<String> shadowed, ValidateCtx ctx) {
        DatasetQuery query = compileLoopQuery(loop, shadowed, ctx);
        rejectFolderOnSet(loop, query, String.join(".", loop.accessor().path()), ctx);
        List<String> path = loop.accessor().path();
        if (ctx.contentDef == null || ctx.references == null || path.size() != 1 || shadowed.contains(path.get(0))) {
            return;
        }
        String restriction = ctx.contentDef.findEditor(path.get(0))
                .filter(editor -> editor.type() == EditorType.REFERENCE)
                .map(EditorDefinition::dataset)
                .filter(dataset -> !dataset.isBlank())
                .orElse(null);
        if (restriction != null) {
            ReferenceResolver references = ctx.references;
            checkLoopFields(
                    loop, query, references.resolve(DATASET_PREFIX, restriction).flatMap(references::datasetDefinition), ctx);
        }
    }

    /**
     * Parses a loop's named arguments into the query the renderer applies (M19.3.2), once per compile, so a bad
     * argument is a compile-time {@code SF-TPL-0140} instead of a render-time surprise. Accessors of {@code where}
     * not rooted at the loop variable are ordinary scope accessors and are checked like any other.
     */
    private DatasetQuery compileLoopQuery(OctlNode.For loop, Set<String> shadowed, ValidateCtx ctx) {
        Map<String, String> args = new LinkedHashMap<>();
        loop.args().forEach(arg -> args.put(arg.name(), arg.value()));
        DatasetQueryParser.Result parsed = DatasetQueryParser.parse(args, loop.variable(), loop.line(), loop.col());
        ctx.diagnostics.addAll(parsed.diagnostics());
        ctx.datasetQueries.put(loop, parsed.query());

        if (parsed.query().where() != null) {
            Set<String> withLoop = new HashSet<>(shadowed);
            withLoop.add(loop.variable());
            List<Expr.Access> accesses = new ArrayList<>();
            DatasetQueryParser.collectAllAccesses(parsed.query().where(), accesses);
            for (Expr.Access access : accesses) {
                checkAccessorRoot(access.accessor(), withLoop, loop.line(), loop.col(), ctx);
                checkFilters(access.filters(), loop.line(), loop.col(), ctx);
            }
        }
        return parsed.query();
    }

    /** {@code SF-TPL-0141}/{@code 0142} for a loop's {@code where}/{@code sort} fields, when the schema is known. */
    private static void checkLoopFields(
            OctlNode.For loop, DatasetQuery query, Optional<ContentDefinition> definition, ValidateCtx ctx) {
        definition.ifPresent(schema -> ctx.diagnostics.addAll(
                DatasetQueryParser.validateFields(query, schema, loop.line(), loop.col())));
    }

    /** A record set is its own scope (epic decision 5): {@code folder=} on a set loop is {@code SF-TPL-0140}. */
    private static void rejectFolderOnSet(OctlNode.For loop, DatasetQuery query, String source, ValidateCtx ctx) {
        if (query.folder() != null) {
            ctx.diagnostics.add(Diagnostic.error(
                    DiagnosticCodes.OCTL_DATASET_QUERY,
                    "Argument folder is not available on a record set loop (" + source
                            + "): the set is the scope; filter with where instead",
                    loop.line(), loop.col()));
        }
    }

    /** A path-less {@code recordset:uid}: the set itself, rendered as a value or iterated by a loop (M25.2.2). */
    private static boolean isRecordSetSource(Accessor accessor) {
        return accessor.isAssetReference() && RECORD_SET_PREFIX.equals(accessor.assetType()) && accessor.path().isEmpty();
    }

    private void resolveReference(Accessor accessor, int line, int col, ValidateCtx ctx) {
        if (ctx.references == null) {
            return;
        }
        String key = accessor.referenceKey();
        var resolved = ctx.references.resolve(accessor.assetType(), accessor.uid());
        if (resolved.isPresent()) {
            ctx.refMap.putIfAbsent(key, resolved.get());
        } else {
            ctx.diagnostics.add(Diagnostic.error(
                    DiagnosticCodes.OCTL_UNRESOLVABLE_REF,
                    "Unresolvable asset reference: " + key, line, col));
        }
    }

    /**
     * {@code CMS_PAGINATION} (M21.3.1), {@code CMS_LOCALES} (M24.3.1) and {@code CMS_META} (M30.2.2) are read-only: no
     * {@code $CMS_SET} or loop variable may take their names.
     */
    private static void checkNotPaginationRoot(String name, int line, int col, ValidateCtx ctx) {
        if (LOCALES_ROOT.equals(name) || META_ROOT.equals(name)) {
            ctx.diagnostics.add(Diagnostic.error(
                    DiagnosticCodes.OCTL_PAGINATION_READ_ONLY,
                    name + " is read-only: pick another variable name",
                    line, col));
            return;
        }
        if (PAGINATION_ROOT.equals(name)) {
            ctx.diagnostics.add(Diagnostic.error(
                    DiagnosticCodes.OCTL_PAGINATION_READ_ONLY,
                    PAGINATION_ROOT + " is read-only: pick another variable name",
                    line,
                    col));
        }
    }

    /** A record template's own names besides the dataset's fields: the record meta fields and its position. */
    private static boolean isRecordScopeName(String name) {
        return RecordView.META_FIELDS.contains(name) || RECORD_META_OBJECT.equals(name)
                || RECORD_POSITION_FIELDS.contains(name);
    }

    private static void notInRecordTemplate(String what, String reason, int line, int col, ValidateCtx ctx) {
        ctx.diagnostics.add(Diagnostic.error(
                DiagnosticCodes.OCTL_NOT_ALLOWED_IN_RECORD_TEMPLATE,
                what + " is not available in a dataset record template: " + reason,
                line,
                col));
    }

    private static void notInTextMedia(String what, int line, int col, List<Diagnostic> diagnostics) {
        diagnostics.add(Diagnostic.error(
                DiagnosticCodes.OCTL_NOT_ALLOWED_IN_TEXT_MEDIA,
                what + " is not available in text media: the file belongs to no page",
                line,
                col));
    }

    /** JS/JSON text media: a value without an escaping filter can break out of a string literal. */
    private static void checkTextMediaEscaping(OctlNode.Value value, ValidateCtx ctx) {
        if (ctx.textMedia == null || !ctx.textMedia.scriptLike()) {
            return;
        }
        boolean escaped = value.filters().stream().anyMatch(f -> TEXT_MEDIA_ESCAPING_FILTERS.contains(f.name()));
        if (!escaped) {
            ctx.diagnostics.add(Diagnostic.warning(
                    DiagnosticCodes.OCTL_TEXT_MEDIA_UNESCAPED_VALUE,
                    "$CMS_VALUE without an escaping filter in a JavaScript/JSON file; add | js or | json"
                            + " (or | raw when the value is meant to be code)",
                    value.line(),
                    value.col()));
        }
    }

    /**
     * One {@code SF-TPL-0320} warning per {@code $$} escape, except inside a {@code $CMS_COMMENT$}
     * block, whose content never reaches the output. Comment spans come from the token stream the
     * parser consumes: a comment runs from {@code $CMS_COMMENT$} to the first
     * {@code $CMS_END_COMMENT$}, or to the end of the source.
     */
    private static void warnDollarEscapes(OctlLexer.LexResult lexed, List<Diagnostic> diagnostics) {
        List<OctlLexer.Position> commentBounds = new ArrayList<>();
        boolean inComment = false;
        for (OctlLexer.Token token : lexed.tokens()) {
            if (!token.isInstruction()) {
                continue;
            }
            String keyword = OctlParser.keyword(token.text());
            if (keyword.equals(inComment ? "END_COMMENT" : "COMMENT")) {
                commentBounds.add(new OctlLexer.Position(token.line(), token.col()));
                inComment = !inComment;
            }
        }
        for (OctlLexer.Position escape : lexed.escapes()) {
            // An odd number of comment bounds before the escape means it sits inside a comment.
            long boundsBefore = commentBounds.stream().filter(bound -> bound.isBefore(escape)).count();
            if (boundsBefore % 2 == 0) {
                diagnostics.add(Diagnostic.warning(
                        DiagnosticCodes.OCTL_TEXT_MEDIA_DOLLAR_ESCAPE,
                        "$$ is output as a single $ when CMS processing is on",
                        escape.line(),
                        escape.col()));
            }
        }
    }

    private void checkBody(OctlNode.Body body, ValidateCtx ctx) {
        if (ctx.namesUnknown) {
            return;
        }
        boolean isSection = ctx.contentDef == null || ctx.contentDef.bodies().isEmpty();
        if (isSection) {
            ctx.diagnostics.add(Diagnostic.error(
                    DiagnosticCodes.OCTL_BODY_IN_SECTION,
                    "$CMS_BODY is only valid in a page template with declared bodies", body.line(), body.col()));
            return;
        }
        if (ctx.contentDef.findBody(body.name()).isPresent()) {
            ctx.usedBodies.add(body.name());
        }
    }

    private void checkRaw(Accessor accessor, List<FilterNode> filters, int line, int col, ValidateCtx ctx) {
        if (ctx.contentDef == null || accessor.isAssetReference()) {
            return;
        }
        boolean hasRaw = filters.stream().anyMatch(f -> "raw".equals(f.name()));
        if (!hasRaw || accessor.path().isEmpty()) {
            return;
        }
        String name = accessor.path().get(0);
        var editor = ctx.contentDef.findEditor(name);
        if (editor.isPresent()
                && (editor.get().type() == EditorType.TEXT || editor.get().type() == EditorType.TEXTAREA)) {
            ctx.diagnostics.add(Diagnostic.warning(
                    DiagnosticCodes.OCTL_RAW_ON_TEXT,
                    "'raw' filter on a plain-text editor; prefer escaping", line, col));
        }
    }

    private static String sha256(String input) {
        try {
            MessageDigest digest = MessageDigest.getInstance(HASH_ALGORITHM);
            byte[] bytes = digest.digest(input.getBytes(StandardCharsets.UTF_8));
            StringBuilder sb = new StringBuilder(bytes.length * 2);
            for (byte b : bytes) {
                sb.append(Character.forDigit((b >> 4) & 0xF, 16)).append(Character.forDigit(b & 0xF, 16));
            }
            return sb.toString();
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException("SHA-256 unavailable", e);
        }
    }

    /** The compile profile of a processed text media file. */
    private record TextMedia(boolean scriptLike) {}

    private static final class ValidateCtx {
        final ReferenceResolver references;
        final ContentDefinition contentDef;
        final Map<String, UUID> refMap;
        final List<Diagnostic> diagnostics;
        final Set<String> usedEditors = new HashSet<>();
        final Set<String> usedBodies = new HashSet<>();
        /** Dataset loops' compiled queries, by loop node identity (M19.3.2). */
        final Map<OctlNode.For, DatasetQuery> datasetQueries = new IdentityHashMap<>();
        /** The text media profile, or {@code null} when compiling a template. */
        final TextMedia textMedia;
        /** Compiling a dataset record template (M25): the record is the scope, inheritance and bodies are errors. */
        final boolean recordTemplate;
        /** A template that extends but whose chain didn't link: inherited names are unknown, so none are checked. */
        final boolean namesUnknown;

        ValidateCtx(
                ReferenceResolver references,
                ContentDefinition contentDef,
                Map<String, UUID> refMap,
                List<Diagnostic> diagnostics,
                TextMedia textMedia,
                boolean recordTemplate,
                boolean namesUnknown) {
            this.references = references;
            this.contentDef = contentDef;
            this.refMap = refMap;
            this.diagnostics = diagnostics;
            this.textMedia = textMedia;
            this.recordTemplate = recordTemplate;
            this.namesUnknown = namesUnknown;
        }

    }
}
