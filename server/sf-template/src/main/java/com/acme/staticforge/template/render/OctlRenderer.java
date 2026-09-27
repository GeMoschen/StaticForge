package com.acme.staticforge.template.render;

import com.acme.staticforge.common.L10nValues;
import com.acme.staticforge.template.diagnostic.Diagnostic;
import com.acme.staticforge.template.diagnostic.DiagnosticCodes;
import com.acme.staticforge.template.octl.Accessor;
import com.acme.staticforge.template.octl.CompiledTemplate;
import com.acme.staticforge.template.octl.OctlCompiler;
import com.acme.staticforge.template.octl.Expr;
import com.acme.staticforge.template.octl.FilterNode;
import com.acme.staticforge.template.octl.NamedArg;
import com.acme.staticforge.template.octl.OctlNode;
import com.acme.staticforge.template.query.DatasetQuery;
import com.acme.staticforge.template.query.DatasetQueryEvaluator;
import com.acme.staticforge.template.query.DatasetQueryParser;
import com.acme.staticforge.template.query.RecordSetQueries;
import com.acme.staticforge.template.query.RecordView;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.BooleanNode;
import com.fasterxml.jackson.databind.node.IntNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.MissingNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.fasterxml.jackson.databind.node.TextNode;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Deque;
import java.util.HashMap;
import java.util.HashSet;
import java.util.IdentityHashMap;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.function.Supplier;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Thread-safe, side-effect-free stack-machine renderer (spec §16.5, §16.10). Walks the
 * compiled AST against a {@link RenderContext}, producing output plus the set of touched
 * asset UUIDs. A fresh per-render {@link State} carries all mutable data, so a single
 * renderer instance is safe to share across concurrent virtual threads.
 *
 * <p>Guard rails throw {@link RenderLimitException} so a caller can fail the affected file
 * with a diagnostic rather than abort the whole build. They are enforced through the context's
 * {@link RenderBudget} — shared with every nested render the resolvers trigger, so limits apply
 * to the whole page — or a fresh budget when the context carries none.
 */
public final class OctlRenderer implements Renderer {

    public OctlRenderer() {}

    @Override
    public RenderResult render(CompiledTemplate template, RenderContext context) {
        RenderBudget budget = context.budget() != null ? context.budget() : new RenderBudget();
        State s = new State(template, context, budget);
        for (CompiledTemplate.Ancestor ancestor : template.ancestors()) {
            if (ancestor.uuid() != null) {
                s.deps.add(ancestor.uuid());
            }
        }
        // A template that extends renders its root layout (M20), after its chain's child-level $CMS_SETs.
        renderNodes(template.setupNodes(), s);
        renderNodes(template.layoutNodes(), s);
        return new RenderResult(s.out.toString(), s.deps, s.warnings);
    }

    // ------------------------------------------------------------------
    // Node dispatch
    // ------------------------------------------------------------------

    private void renderNodes(List<OctlNode> nodes, State s) {
        for (OctlNode node : nodes) {
            s.budget.checkTime();
            switch (node) {
                case OctlNode.Text t -> s.append(t.value());
                case OctlNode.Value v -> renderValue(v, s);
                case OctlNode.Ref r -> renderRef(r, s);
                case OctlNode.Body b -> renderBody(b, s);
                case OctlNode.Include i -> renderInclude(i, s);
                case OctlNode.Navigation nav -> renderNavigation(nav, s);
                case OctlNode.NavigationRecurse nr -> renderNavigationRecurseInstruction(nr, s);
                case OctlNode.If f -> renderIf(f, s);
                case OctlNode.For f -> renderFor(f, s);
                case OctlNode.Set st -> renderSet(st, s);
                case OctlNode.Meta m -> renderMeta(m, s);
                case OctlNode.Comment c -> { /* discarded */ }
                case OctlNode.Extends e -> { /* linked at compile time */ }
                case OctlNode.Block b -> renderBlock(b, s);
                case OctlNode.Parent p -> renderParent(s);
            }
        }
    }

    /**
     * {@code $CMS_BLOCK(name)$} renders the block's most-derived definition along the chain (M20); without a
     * chain that is the block's own body. Blocks are looked up by name wherever they appear, so an inner
     * block inside an outer block's inherited definition still renders its own override. A block that is
     * already rendering is skipped: the compiler rejects such tables ({@code SF-TPL-0162}), and this keeps
     * a render finite whatever it is handed.
     */
    private void renderBlock(OctlNode.Block block, State s) {
        List<List<OctlNode>> definitions = s.template.blocks().get(block.name());
        if (definitions == null || definitions.isEmpty()) {
            renderNodes(block.body(), s);
            return;
        }
        for (BlockFrame frame : s.blocks) {
            if (frame.name.equals(block.name())) {
                return;
            }
        }
        renderDefinition(block.name(), 0, definitions, s);
    }

    /** {@code $CMS_PARENT$}: the next less-derived definition of the innermost rendering block; empty at the root. */
    private void renderParent(State s) {
        BlockFrame current = s.blocks.peek();
        if (current == null) {
            return;
        }
        List<List<OctlNode>> definitions = s.template.blocks().get(current.name);
        int next = current.depth + 1;
        if (definitions != null && next < definitions.size()) {
            renderDefinition(current.name, next, definitions, s);
        }
    }

    private void renderDefinition(String name, int depth, List<List<OctlNode>> definitions, State s) {
        s.blocks.push(new BlockFrame(name, depth));
        try {
            renderNodes(definitions.get(depth), s);
        } finally {
            s.blocks.pop();
        }
    }

    private void renderValue(OctlNode.Value v, State s) {
        Accessor accessor = v.accessor();
        if (isRecordSetSource(accessor)) {
            noteReference(accessor, s);
            UUID set = s.template.references().get(accessor.referenceKey());
            if (set != null) {
                renderRecordSetValue(set, accessor.referenceKey(), v, s);
            }
            return;
        }
        JsonNode value = resolve(accessor, s);
        s.collectDeps(value);
        if (isCatalog(value)) {
            renderCatalogValue(value, s);
            return;
        }
        UUID referencedSet = recordSetReference(value);
        if (referencedSet != null) {
            renderRecordSetValue(referencedSet, recordSetKey(referencedSet), v, s);
            return;
        }
        s.append(applyFilters(value, v.filters(), s));
    }

    private void renderMeta(OctlNode.Meta m, State s) {
        JsonNode value = resolveMeta(m.accessor(), s);
        s.append(applyFilters(value, m.filters(), s));
    }

    private void renderRef(OctlNode.Ref r, State s) {
        Accessor accessor = r.accessor();
        boolean assetItself = accessor.isAssetReference() && accessor.path().isEmpty();
        JsonNode value = assetItself ? null : resolve(accessor, s);
        String direct = directLinkUrl(value);
        if (direct != null) {
            s.append(Filters.escape(direct, s.context.escaping()));
            return;
        }
        RefTarget target = resolveRefTarget(accessor, value, s);
        if (target == null) {
            s.append("");
            return;
        }
        UrlResolver resolver = s.context.urlResolver();
        if (resolver == null) {
            s.append("");
            return;
        }
        Map<String, String> args = new LinkedHashMap<>();
        for (NamedArg a : r.args()) {
            args.put(a.name(), a.value());
        }
        String url = resolver.resolve(target.kind, target.uid, target.uuid, args);
        s.append(url == null ? "" : url);
    }

    private void renderBody(OctlNode.Body b, State s) {
        BlockResolver resolver = s.context.blockResolver();
        if (resolver != null) {
            s.appendResolved(() -> resolver.renderBody(b.name()));
        }
    }

    /**
     * A CATALOG editor's value is a typed object {@code {type:"CATALOG", cards:[…]}}. When a
     * {@code $CMS_VALUE(accessor)$} resolves to one, render its cards instead of stringifying
     * the object — each card rendered exactly like a body's section instance via
     * {@link BlockResolver#renderCatalog}, so a card's own template may itself declare another
     * CATALOG editor and recurse.
     */
    private static boolean isCatalog(JsonNode value) {
        return value != null && value.isObject()
                && "CATALOG".equals(value.path("type").asText(null))
                && value.path("cards").isArray();
    }

    private void renderCatalogValue(JsonNode value, State s) {
        JsonNode cards = value == null ? MissingNode.getInstance() : value.path("cards");
        collectCatalogDeps(cards, s);
        BlockResolver resolver = s.context.blockResolver();
        if (resolver != null) {
            s.appendResolved(() -> resolver.renderCatalog(cards));
        }
    }

    /** {@code State.collectDeps} only recognizes a {@code uuid} field; cards reference their section template via {@code templateRef}. */
    private static void collectCatalogDeps(JsonNode cards, State s) {
        if (cards == null || !cards.isArray()) {
            return;
        }
        for (JsonNode card : cards) {
            String templateRef = card == null ? null : card.path("templateRef").asText(null);
            if (templateRef == null || templateRef.isBlank()) {
                continue;
            }
            try {
                s.deps.add(UUID.fromString(templateRef));
            } catch (IllegalArgumentException ignore) {
                // not a valid uuid value; skip
            }
        }
    }

    // ------------------------------------------------------------------
    // Record sets (M25.2.2)
    // ------------------------------------------------------------------

    /** A path-less {@code recordset:uid}: the set itself, rendered as a value or iterated by a loop. */
    private static boolean isRecordSetSource(Accessor accessor) {
        return accessor.isAssetReference()
                && OctlCompiler.RECORD_SET_PREFIX.equals(accessor.assetType())
                && accessor.path().isEmpty();
    }

    /** The set a {@code reference} editor value points at ({@code {type:"ASSET_REF", uuid, assetType:"RECORD_SET"}}), else {@code null}. */
    private static UUID recordSetReference(JsonNode value) {
        if (value == null || !value.isObject()
                || !"ASSET_REF".equals(value.path("type").asText(null))
                || !"RECORD_SET".equalsIgnoreCase(value.path("assetType").asText(""))) {
            return null;
        }
        return readUuid(value);
    }

    /** The key a set reached through a {@code reference} value is warned about under (it has no uid in the source). */
    private static String recordSetKey(UUID set) {
        return OctlCompiler.RECORD_SET_PREFIX + ":" + set;
    }

    /**
     * {@code $CMS_VALUE(recordset:uid)$}, or a {@code reference} editor value pointing at a set: the records the set's
     * stored query selects, each rendered through the dataset's record template for this channel with the record as
     * the template's scope, concatenated. The loop meta names {@code _index}, {@code _first}, {@code _last} and
     * {@code _count} are the record's position in the selected list. Filters ({@code | …}) apply to the concatenated
     * output, which is rendered markup and so is not escaped again.
     *
     * <p>The set is pushed onto the budget's nesting stack like an include: a record template that renders the set it
     * is rendered for — directly or through other sets — is an {@code SF-TPL-0135} cycle, never a stack overflow, and
     * every record counts as a loop iteration ({@code SF-TPL-0131}). A set without a record template for the channel
     * renders empty with {@code SF-GEN-0241}.
     */
    private void renderRecordSetValue(UUID set, String key, OctlNode.Value v, State s) {
        s.appendResolved(() -> {
            String rendered = renderRecordSet(set, key, v, s);
            // Like any value: a missing or empty set still runs its filters (a default filter, for example).
            return v.filters().isEmpty() ? rendered : filterRendered(rendered, v.filters(), s);
        });
    }

    /** The set's records rendered through the record template and concatenated; empty when it can't be rendered. */
    private String renderRecordSet(UUID set, String key, OctlNode.Value v, State s) {
        SetSelection selection = selectRecordSet(set, key, s);
        BlockResolver resolver = s.context.blockResolver();
        if (selection == null || resolver == null) {
            return "";
        }
        RecordSetSource source = selection.source();
        CompiledTemplate recordTemplate = source.datasetUuid() == null ? null : resolver.recordTemplate(source.datasetUuid());
        if (recordTemplate == null) {
            s.warnOnce(Diagnostic.warning(
                    DiagnosticCodes.GEN_RECORD_TEMPLATE_MISSING,
                    "Record set '" + source.uid() + "' renders empty: dataset '" + nullToEmpty(source.datasetUid())
                            + "' has no '" + s.context.channelKey() + "' record template.",
                    v.line(),
                    v.col()));
            return "";
        }
        return s.budget.withTemplate(
                set,
                OctlCompiler.RECORD_SET_PREFIX + ":" + source.uid(),
                () -> renderRecords(recordTemplate, selection.records(), v.line(), v.col(), s));
    }

    /** Renders each record through {@code recordTemplate} in a context nested in this render's (same resolvers and budget). */
    private String renderRecords(CompiledTemplate recordTemplate, List<RecordView> records, int line, int col, State s) {
        StringBuilder out = new StringBuilder();
        int count = records.size();
        for (int index = 0; index < count; index++) {
            s.budget.countLoopIteration(line, col);
            ObjectNode values = JsonNodeFactory.instance.objectNode();
            records.get(index).item().fields().forEachRemaining(field -> values.set(field.getKey(), field.getValue()));
            values.put("_index", index);
            values.put("_first", index == 0);
            values.put("_last", index == count - 1);
            values.put("_count", count);
            // Nested in this render: same resolvers, locale and budget; the record (and its position) is the scope.
            RenderContext recordContext = s.context.toBuilder().values(values).budget(s.budget).build();
            RenderResult result = render(recordTemplate, recordContext);
            s.deps.addAll(result.dependencies());
            result.warnings().forEach(s::warnOnce);
            out.append(result.output());
        }
        return out.toString();
    }

    /** A value form's filters over a set's rendered records: applied like on any value, without escaping the markup again. */
    private String filterRendered(String rendered, List<FilterNode> filters, State s) {
        return Filters.stringify(pipe(TextNode.valueOf(rendered), filters, s));
    }

    /**
     * The set's source and the records its stored query selects for this render's language — memoized per render, so
     * a template reading {@code recordset:uid._count} in a loop selects once. {@code null} when the set can't be read.
     */
    private SetSelection selectRecordSet(UUID set, String key, State s) {
        SetSelection cached = s.sets.get(set);
        if (cached != null) {
            return cached;
        }
        RecordSetSource source = recordSetSource(set, key, s);
        if (source == null) {
            return null;
        }
        List<RecordView> records = RecordSetQueries.select(source.records(), source.query(), s.context.localeChain());
        SetSelection selection = new SetSelection(source, records, recordSetValue(source, records));
        s.sets.put(set, selection);
        return selection;
    }

    /**
     * The set from the context's {@link AssetValueResolver#recordSet}, recording the set and its dataset as
     * dependencies. A missing or deleted set warns {@code SF-TPL-0112} (once per key), a stored query that no longer
     * validates warns {@code SF-GEN-0240} — such a set selects nothing, it is never shown unfiltered.
     */
    private RecordSetSource recordSetSource(UUID set, String key, State s) {
        AssetValueResolver resolver = s.context.assetValueResolver();
        s.deps.add(set);
        if (resolver == null) {
            return null;
        }
        RecordSetSource source = resolver.recordSet(set);
        if (source == null) {
            warnMissingTarget(key, s);
            return null;
        }
        if (source.datasetUuid() != null) {
            s.deps.add(source.datasetUuid());
        }
        if (!source.query().valid()) {
            s.warnOnce(RecordSetQueries.invalidQueryWarning(source.uid(), source.query()));
        }
        return source;
    }

    /** A set's root value object: {@code {records: [...], _count, _meta: {uid, displayName, dataset}}} (see {@link AssetValueResolver}). */
    private static JsonNode recordSetValue(RecordSetSource source, List<RecordView> records) {
        ObjectNode root = JsonNodeFactory.instance.objectNode();
        ArrayNode items = root.putArray("records");
        records.forEach(record -> items.add(record.item()));
        root.put("_count", records.size());
        ObjectNode meta = root.putObject("_meta");
        meta.put("uid", source.uid());
        meta.put("displayName", source.displayName());
        meta.put("dataset", source.datasetUid());
        return root;
    }

    /**
     * The items of a record set loop — {@code $CMS_FOR(x : recordset:uid, …)$} or a loop over a {@code reference}
     * editor pointing at a set: the set's stored query first, then the loop's arguments narrow its result (epic
     * decision 5). The items are the objects a dataset loop binds. For a {@code reference} editor ({@code checkFields})
     * the arguments' fields are checked here, against the referenced set's dataset: an unknown field warns
     * {@code SF-TPL-0141} (once per loop and render) and reads as missing, so records it filters on are skipped — the
     * rule a dataset loop's unresolvable fields follow.
     */
    private JsonNode recordSetItems(OctlNode.For loop, UUID set, String key, boolean checkFields, State s) {
        DatasetQuery narrowing = s.template.datasetQuery(loop);
        List<RecordView> records;
        if (narrowing == null) {
            SetSelection selection = selectRecordSet(set, key, s);
            if (selection == null) {
                return null;
            }
            records = selection.records();
        } else {
            RecordSetSource source = recordSetSource(set, key, s);
            if (source == null) {
                return null;
            }
            if (checkFields && source.datasetDefinition() != null && s.checkedLoops.put(loop, Boolean.TRUE) == null) {
                for (Diagnostic finding : DatasetQueryParser.validateFields(
                        narrowing, source.datasetDefinition(), loop.line(), loop.col())) {
                    s.warnOnce(Diagnostic.warning(finding.code(), finding.message(), finding.line(), finding.column()));
                }
            }
            records = RecordSetQueries.select(
                    source.records(), source.query(), s.context.localeChain(), narrowing, scopeAccessor -> resolve(scopeAccessor, s));
        }
        ArrayNode items = JsonNodeFactory.instance.arrayNode(records.size());
        records.forEach(record -> items.add(record.item()));
        return items;
    }

    /**
     * Include depth and cycles are not tracked here: the resolver renders the section through a
     * nested {@link Renderer#render} call, guarded by {@link RenderBudget#withTemplate}.
     */
    private void renderInclude(OctlNode.Include i, State s) {
        // Resolving the referenced template's UUID keeps it in the dependency set.
        noteReference(i.accessor(), s);
        BlockResolver resolver = s.context.blockResolver();
        if (resolver != null) {
            String uid = resolvedUid(i.accessor(), s);
            s.appendResolved(() -> resolver.renderInclude(uid, namedArgs(i.args())));
        }
    }

    private void renderNavigation(OctlNode.Navigation nav, State s) {
        // Resolving the referenced folder's UUID keeps it in the dependency set (mirrors
        // renderInclude's noteReference call).
        noteReference(nav.accessor(), s);
        UUID navFolderUuid = s.template.references().get(nav.accessor().referenceKey());
        if (navFolderUuid == null) {
            s.append("");
            return;
        }
        BlockResolver resolver = s.context.blockResolver();
        if (nav.variable() == null) {
            // Leaf form: the fixed default-rendered markup (NavigationHtmlRenderer), unchanged.
            if (resolver != null) {
                s.appendResolved(() -> resolver.renderNavigation(navFolderUuid, namedArgs(nav.args())));
            }
            return;
        }
        // Block form: fetch the top-level children as data and let the template's own body
        // render each one, exactly like $CMS_FOR — $CMS_NAVIGATION_RECURSE descends further.
        JsonNode children = resolver == null ? null : resolver.resolveNavigationChildren(navFolderUuid, namedArgs(nav.args()));
        renderNavItems(children, nav.variable(), nav.body(), 0, nav.line(), nav.col(), s);
    }

    /** Shared iteration for block-form {@code $CMS_NAVIGATION}'s top level and {@code $CMS_NAVIGATION_RECURSE}'s descent. */
    private void renderNavItems(
            JsonNode children, String variable, List<OctlNode> body, int depth, int line, int col, State s) {
        if (children == null || !children.isArray()) {
            return;
        }
        int count = children.size();
        for (int index = 0; index < count; index++) {
            s.budget.countLoopIteration(line, col);
            s.pushLoop(new LoopFrame(variable, children.get(index), index, count, depth, body));
            try {
                renderNodes(body, s);
            } finally {
                s.popLoop();
            }
        }
    }

    /** {@code $CMS_NAVIGATION_RECURSE(item)$}: renders {@code item}'s children with the enclosing block's own body. */
    private void renderNavigationRecurseInstruction(OctlNode.NavigationRecurse nr, State s) {
        LoopFrame frame = s.findLoop(nr.variable());
        if (frame == null || frame.body == null) {
            return;
        }
        JsonNode children = frame.item == null ? null : frame.item.path("children");
        renderNavItems(children, frame.variable, frame.body, frame.depth + 1, nr.line(), nr.col(), s);
    }

    /** The UID string stored on the reference, falling back to the resolved UUID when absent. */
    private static String resolvedUid(Accessor accessor, State s) {
        String uid = accessor.uid();
        if (uid != null && !uid.isBlank()) {
            return uid;
        }
        UUID uuid = s.template.references().get(accessor.referenceKey());
        return uuid == null ? uid : uuid.toString();
    }

    private static Map<String, String> namedArgs(List<NamedArg> args) {
        Map<String, String> out = new LinkedHashMap<>();
        for (NamedArg a : args) {
            out.put(a.name(), a.value());
        }
        return out;
    }

    private static String nullToEmpty(String s) {
        return s == null ? "" : s;
    }

    private void renderIf(OctlNode.If f, State s) {
        for (OctlNode.Branch branch : f.branches()) {
            if (truthy(eval(branch.condition(), s))) {
                renderNodes(branch.body(), s);
                return;
            }
        }
        renderNodes(f.elseBody(), s);
    }

    private void renderFor(OctlNode.For f, State s) {
        JsonNode list = resolveForList(f, s);
        if (list == null || !list.isArray()) {
            return;
        }
        int count = list.size();
        for (int index = 0; index < count; index++) {
            s.budget.countLoopIteration(f.line(), f.col());
            s.pushLoop(new LoopFrame(f.variable(), list.get(index), index, count));
            try {
                renderNodes(f.body(), s);
            } finally {
                s.popLoop();
            }
        }
    }

    /**
     * {@code $CMS_FOR$}'s accessor resolution: a {@code nav:uid} reference bootstraps its
     * top-level children from {@link BlockResolver#resolveNavigationChildren}; a {@code dataset:uid}
     * reference yields the records its compiled query selects (M19.3.2); a {@code recordset:uid} reference, or a
     * value that is a {@code reference} to a record set, yields the set's selected records narrowed by the loop's
     * arguments (M25.2.2); every other accessor (including a cross-asset {@code page:uid.list}) goes through the
     * normal {@link #resolve} path.
     */
    private JsonNode resolveForList(OctlNode.For loop, State s) {
        Accessor accessor = loop.accessor();
        List<NamedArg> args = loop.args();
        if (accessor.isAssetReference() && "dataset".equals(accessor.assetType())) {
            return datasetItems(loop, s);
        }
        if (isRecordSetSource(accessor)) {
            noteReference(accessor, s);
            UUID set = s.template.references().get(accessor.referenceKey());
            return set == null ? null : recordSetItems(loop, set, accessor.referenceKey(), false, s);
        }
        if (accessor.isAssetReference() && "nav".equals(accessor.assetType())) {
            noteReference(accessor, s);
            UUID navFolderUuid = s.template.references().get(accessor.referenceKey());
            if (navFolderUuid == null) {
                return null;
            }
            BlockResolver resolver = s.context.blockResolver();
            return resolver == null ? null : resolver.resolveNavigationChildren(navFolderUuid, namedArgs(args));
        }
        JsonNode value = resolve(accessor, s);
        UUID referencedSet = recordSetReference(value);
        return referencedSet == null ? value : recordSetItems(loop, referencedSet, recordSetKey(referencedSet), true, s);
    }

    /**
     * The items of a dataset loop: the dataset's records from the context's
     * {@link AssetValueResolver#datasetRecords}, filtered, sorted and sliced by the query compiled
     * with the loop. A {@code where} accessor that is not a record field reads the current render
     * scope, so {@code member.team == CMS_PAGE.team} compares against this page. The loop depends on
     * the dataset itself (M19 dependency granularity: any record change rebuilds the page).
     */
    private JsonNode datasetItems(OctlNode.For loop, State s) {
        noteReference(loop.accessor(), s);
        UUID dataset = s.template.references().get(loop.accessor().referenceKey());
        AssetValueResolver resolver = s.context.assetValueResolver();
        DatasetQuery query = s.template.datasetQuery(loop);
        if (dataset == null || resolver == null || query == null) {
            return null;
        }
        // Records are resolved for the render language *before* the query runs, so `where` and
        // `sort` compare the language being rendered rather than the wrapper (M24.3.3).
        List<String> chain = s.context.localeChain();
        List<RecordView> source = resolver.datasetRecords(dataset);
        if (!chain.isEmpty()) {
            source = source.stream().map(record -> record.resolvedFor(chain)).toList();
        }
        List<RecordView> records = DatasetQueryEvaluator.apply(
                source,
                query,
                scopeAccessor -> resolve(scopeAccessor, s),
                chain.isEmpty() ? null : java.text.Collator.getInstance(Filters.localeOf(s.context.locale())));
        ArrayNode items = JsonNodeFactory.instance.arrayNode(records.size());
        for (RecordView record : records) {
            items.add(record.item());
        }
        return items;
    }

    private void renderSet(OctlNode.Set st, State s) {
        JsonNode value = eval(st.expr(), s);
        if (value == null) {
            value = MissingNode.getInstance();
        }
        s.setVar(st.name(), value);
    }

    /** The render's language for locale-aware filters, neutral in a project without locales. */
    private static java.util.Locale renderLocale(State s) {
        return Filters.localeOf(s.context.locale());
    }

    private String applyFilters(JsonNode value, List<FilterNode> filters, State s) {
        boolean escaped = false;
        for (FilterNode f : filters) {
            Filter filter = Filters.lookup(f.name());
            if (filter == null) {
                continue;
            }
            if (Filters.isEscapingOrRaw(f.name())) {
                escaped = true;
            }
            value = filter.apply(value, f.args(), renderLocale(s));
        }
        String text = Filters.stringify(value);
        if (!escaped) {
            text = Filters.escape(text, s.context.escaping());
        }
        return text;
    }

    // ------------------------------------------------------------------
    // Value resolution and scopes
    // ------------------------------------------------------------------

    private JsonNode resolve(Accessor accessor, State s) {
        return localize(resolveRaw(accessor, s), s);
    }

    /**
     * Resolves a language-dependent value for the render locale (M24.3.1). Done once, here at
     * value lookup, so filters, truthiness and {@code | json} all see the resolved value and no
     * wrapper can leak into output. A no-op in a project without locales (empty chain).
     */
    private static JsonNode localize(JsonNode node, State s) {
        List<String> chain = s.context.localeChain();
        if (chain.isEmpty() || node == null) {
            return node;
        }
        if (L10nValues.isL10n(node)) {
            JsonNode resolved = L10nValues.resolve(node, chain);
            return resolved == null ? MissingNode.getInstance() : resolved;
        }
        // A whole object or list handed to `| json` must not carry wrappers either.
        return node.isContainerNode() && L10nValues.containsL10n(node)
                ? L10nValues.resolveDeep(node, chain)
                : node;
    }

    private JsonNode resolveRaw(Accessor accessor, State s) {
        if (accessor.isAssetReference()) {
            noteReference(accessor, s);
            return resolveCrossAsset(accessor, s);
        }
        List<String> path = accessor.path();
        if (path.isEmpty()) {
            return MissingNode.getInstance();
        }
        String first = path.get(0);
        if ("CMS_PAGE".equals(first)) {
            return resolveSub(s.context.pageValues(), path, 1, s);
        }
        if (OctlCompiler.PAGINATION_ROOT.equals(first)) {
            return resolveSub(s.context.pagination(), path, 1, s);
        }
        if (OctlCompiler.LOCALES_ROOT.equals(first)) {
            return resolveSub(s.context.locales(), path, 1, s);
        }
        if (OctlCompiler.META_ROOT.equals(first)) {
            JsonNode meta = path.size() < 2 ? null : s.context.meta().get(path.get(1));
            return meta == null ? MissingNode.getInstance() : resolveSub(meta, path, 2, s);
        }
        LoopFrame loop = s.findLoop(first);
        if (loop != null) {
            if (path.size() == 1) {
                return loop.item;
            }
            return switch (path.get(1)) {
                case "_index" -> IntNode.valueOf(loop.index);
                case "_first" -> BooleanNode.valueOf(loop.index == 0);
                case "_last" -> BooleanNode.valueOf(loop.index == loop.count - 1);
                case "_count" -> IntNode.valueOf(loop.count);
                case "_depth" -> IntNode.valueOf(loop.depth);
                default -> resolveSub(loop.item, path, 1, s);
            };
        }
        JsonNode setValue = s.findSet(first);
        if (setValue != null) {
            return resolveSub(setValue, path, 1, s);
        }
        return resolveSub(s.context.values(), path, 0, s);
    }

    /**
     * {@code assetType:uid.path}: the target's root value object from the context's {@link
     * AssetValueResolver}, walked by the accessor's path exactly like a local value. Empty when
     * the context has no resolver or the reference did not resolve at compile time. A target the
     * resolver reports as missing (soft-deleted since compile) also renders empty, with one
     * {@code SF-TPL-0112} warning per reference (spec §16.4).
     */
    private JsonNode resolveCrossAsset(Accessor accessor, State s) {
        AssetValueResolver resolver = s.context.assetValueResolver();
        UUID uuid = s.template.references().get(accessor.referenceKey());
        if (resolver == null || uuid == null) {
            return MissingNode.getInstance();
        }
        if (OctlCompiler.RECORD_SET_PREFIX.equals(accessor.assetType())) {
            // A set's value object depends on the render language, so the renderer builds it (M25.2.2).
            SetSelection selection = selectRecordSet(uuid, accessor.referenceKey(), s);
            return selection == null ? MissingNode.getInstance() : resolveSub(selection.value(), accessor.path(), 0, s);
        }
        JsonNode root = resolver.valueOf(accessor.assetType(), uuid);
        if (root == null || root.isMissingNode()) {
            warnMissingTarget(accessor.referenceKey(), s);
            return MissingNode.getInstance();
        }
        return resolveSub(root, accessor.path(), 0, s);
    }

    /** One {@code SF-TPL-0112} per reference key and render: its target is missing or soft-deleted, it renders empty. */
    private static void warnMissingTarget(String key, State s) {
        if (s.missingTargets.add(key)) {
            s.warnings.add(Diagnostic.warning(
                    DiagnosticCodes.OCTL_MISSING_VALUE_TARGET, "Cross-asset value target is missing or deleted: " + key, 0, 0));
        }
    }

    private JsonNode resolveMeta(Accessor accessor, State s) {
        List<String> path = accessor.path();
        if (path.isEmpty()) {
            return MissingNode.getInstance();
        }
        JsonNode node = s.context.meta().get(path.get(0));
        if (node == null) {
            return MissingNode.getInstance();
        }
        return resolveSub(node, path, 1, s);
    }

    private JsonNode resolveSub(JsonNode base, List<String> path, int from, State s) {
        JsonNode node = base;
        for (int i = from; i < path.size(); i++) {
            // A language-dependent value is unwrapped before the path walks into it, so
            // `heroImage.altText` reaches the media asset rather than the L10N wrapper (M24.3.1).
            node = localize(node, s);
            if (node == null || node.isMissingNode() || node.isNull() || !node.isObject()) {
                return MissingNode.getInstance();
            }
            JsonNode next = node.get(path.get(i));
            if (next == null) {
                next = dereference(node, path.get(i), s);
            }
            if (next == null) {
                return MissingNode.getInstance();
            }
            node = next;
        }
        return node == null ? MissingNode.getInstance() : node;
    }

    /**
     * Walking a path through a {@code reference} editor value that points at a record continues in
     * the record (M19.3.2): {@code $CMS_VALUE(author.name)$} reads the referenced record's
     * {@code name}; one that points at a record set continues in the set's root value object (M25.2.2):
     * {@code $CMS_VALUE(featured._count)$}, {@code featured.records}. Only a segment the reference value
     * itself does not have ({@code type}, {@code uuid}, {@code assetType}) dereferences, so
     * {@code author.uuid} keeps meaning the stored value. Each dereference consumes a path segment, so
     * reference cycles between records cannot recurse. The target becomes a render dependency.
     *
     * <p>A {@code media} editor value ({@code MEDIA_REF}) continues in the media asset's root value object the same
     * way: {@code $CMS_VALUE(heroImage.altText)$}, {@code heroImage.width} read the picked media's alt text (in the
     * render language) and size, as the editor reference documents; {@code heroImage.variant} stays the stored value.
     *
     * @return the field of the referenced record, record set or media, or {@code null} when {@code node} is not such
     *     a reference or the target is missing
     */
    private JsonNode dereference(JsonNode node, String segment, State s) {
        UUID set = recordSetReference(node);
        if (set != null) {
            SetSelection selection = selectRecordSet(set, recordSetKey(set), s);
            return selection == null ? null : selection.value().get(segment);
        }
        String type = node.path("type").asText("");
        String kind;
        if ("MEDIA_REF".equals(type)) {
            kind = "media";
        } else if ("ASSET_REF".equals(type) && "RECORD".equalsIgnoreCase(node.path("assetType").asText(""))) {
            kind = "record";
        } else {
            return null;
        }
        AssetValueResolver resolver = s.context.assetValueResolver();
        UUID uuid = readUuid(node);
        if (resolver == null || uuid == null) {
            return null;
        }
        s.deps.add(uuid);
        JsonNode target = resolver.valueOf(kind, uuid);
        return target == null || target.isMissingNode() ? null : target.get(segment);
    }

    // ------------------------------------------------------------------
    // References
    // ------------------------------------------------------------------

    private static final Set<String> REF_KINDS = Set.of("page", "media", "folder");

    private void noteReference(Accessor accessor, State s) {
        if (!accessor.isAssetReference()) {
            return;
        }
        UUID uuid = s.template.references().get(accessor.referenceKey());
        if (uuid != null) {
            s.deps.add(uuid);
        }
    }

    /**
     * The asset a {@code $CMS_REF} points at.
     *
     * <p>A path-less asset reference ({@code page:about}, {@code media:logo}) refs that asset
     * directly. An asset reference <em>with</em> a value path ({@code CMS_GLOBAL.site.logo},
     * {@code page:about.heroImage}) refs what that editor holds, not the asset the editor lives
     * on — it goes through exactly the same media/link resolution a local editor value does. That
     * is what lets {@code $CMS_REF(CMS_GLOBAL.site.logo)$} yield a media URL relative to the
     * rendering page without a second, globals-only code path; before M17.3.1 a path'd reference
     * silently ignored its path and linked the target asset instead.
     */
    private RefTarget resolveRefTarget(Accessor accessor, JsonNode value, State s) {
        if (accessor.isAssetReference() && accessor.path().isEmpty()) {
            String key = accessor.referenceKey();
            UUID uuid = s.template.references().get(key);
            if (uuid == null) {
                return null;
            }
            s.deps.add(uuid);
            String kind = mapKind(accessor.assetType());
            return new RefTarget(kind, accessor.uid(), uuid);
        }
        s.collectDeps(value);
        if (value == null || value.isMissingNode() || value.isNull() || !value.isObject()) {
            return null;
        }
        UUID uuid = readUuid(value);
        if (uuid == null) {
            return null;
        }
        s.deps.add(uuid);
        String kind = linkKind(value);
        String uid = value.has("uid") && value.get("uid").isTextual()
                ? value.get("uid").asText()
                : accessor.path().get(accessor.path().size() - 1);
        return new RefTarget(kind, uid, uuid);
    }

    /**
     * The URL of a {@code link} value that points at no asset: an {@code EXTERNAL} link's {@code url}, a
     * {@code MAIL} link as {@code mailto:}, an {@code ANCHOR} as {@code #anchor} — {@code ""} while it is
     * blank. {@code null} for anything else ({@code INTERNAL}/{@code MEDIA} links and the other editor
     * values go through the {@link UrlResolver}). An external URL with a scheme other than
     * {@link #SAFE_SCHEMES} renders empty: link values are not validated on save, and a
     * {@code javascript:} URL must never reach an {@code href}.
     */
    static String directLinkUrl(JsonNode value) {
        if (value == null || !value.isObject() || value.has("type")) {
            return null;
        }
        return switch (value.path("kind").asText("")) {
            case "EXTERNAL" -> {
                String url = value.path("url").asText("").trim();
                Matcher scheme = URL_SCHEME.matcher(url);
                yield scheme.lookingAt() && !SAFE_SCHEMES.contains(scheme.group(1).toLowerCase(Locale.ROOT))
                        ? ""
                        : url;
            }
            case "MAIL" -> {
                String address = value.path("url").asText("").trim();
                if (address.regionMatches(true, 0, "mailto:", 0, 7)) {
                    address = address.substring(7);
                }
                yield address.isEmpty() ? "" : "mailto:" + address;
            }
            case "ANCHOR" -> {
                String anchor = value.path("anchor").asText("").trim();
                anchor = anchor.startsWith("#") ? anchor.substring(1) : anchor;
                yield anchor.isEmpty() ? "" : "#" + anchor;
            }
            default -> null;
        };
    }

    private static final Pattern URL_SCHEME = Pattern.compile("([a-zA-Z][a-zA-Z0-9+.-]*):");
    private static final Set<String> SAFE_SCHEMES = Set.of("http", "https", "mailto", "tel");

    private static String mapKind(String assetType) {
        return switch (assetType) {
            case "page" -> "page";
            case "media" -> "media";
            case "folder" -> "folder";
            default -> assetType;
        };
    }

    private static String linkKind(JsonNode value) {
        String type = value.has("type") ? value.get("type").asText() : "";
        if ("MEDIA_REF".equals(type)) {
            return "media";
        }
        if ("ASSET_REF".equals(type)) {
            // REFERENCE editor values (`{type:"ASSET_REF", uuid, assetType}`) carry the target
            // kind in `assetType`, not `kind` — falling through to the "page" default below made
            // every REFERENCE-typed link (including ones pointing at MEDIA) render as a page URL.
            String assetType = value.has("assetType") ? value.get("assetType").asText() : "";
            return mapKind(assetType.toLowerCase(java.util.Locale.ROOT));
        }
        String kind = value.has("kind") ? value.get("kind").asText() : "";
        if ("MEDIA".equals(kind)) {
            return "media";
        }
        return "page";
    }

    private static UUID readUuid(JsonNode value) {
        JsonNode uuidNode = value.get("uuid");
        if (uuidNode == null || !uuidNode.isTextual()) {
            return null;
        }
        try {
            return UUID.fromString(uuidNode.asText());
        } catch (IllegalArgumentException e) {
            return null;
        }
    }

    private record RefTarget(String kind, String uid, UUID uuid) {}

    // ------------------------------------------------------------------
    // Expression evaluation
    // ------------------------------------------------------------------

    private JsonNode eval(Expr expr, State s) {
        return switch (expr) {
            case Expr.Literal l -> l.value();
            case Expr.Access a -> {
                JsonNode v = resolve(a.accessor(), s);
                yield pipe(v, a.filters(), s);
            }
            case Expr.Group g -> eval(g.inner(), s);
            case Expr.Not n -> BooleanNode.valueOf(!truthy(eval(n.operand(), s)));
            case Expr.And a -> BooleanNode.valueOf(truthy(eval(a.left(), s)) && truthy(eval(a.right(), s)));
            case Expr.Or o -> BooleanNode.valueOf(truthy(eval(o.left(), s)) || truthy(eval(o.right(), s)));
            case Expr.Cmp c -> BooleanNode.valueOf(compare(c.operator(), eval(c.left(), s), eval(c.right(), s)));
        };
    }

    private JsonNode pipe(JsonNode value, List<FilterNode> filters, State s) {
        for (FilterNode f : filters) {
            Filter filter = Filters.lookup(f.name());
            if (filter == null) {
                continue;
            }
            value = filter.apply(value, f.args(), renderLocale(s));
        }
        return value;
    }

    private static boolean truthy(JsonNode node) {
        if (node == null || node.isNull() || node.isMissingNode()) {
            return false;
        }
        if (node.isBoolean()) {
            return node.asBoolean();
        }
        if (node.isNumber()) {
            return node.asDouble() != 0;
        }
        if (node.isTextual()) {
            return !node.asText().isEmpty();
        }
        return node.size() > 0;
    }

    private static boolean compare(String op, JsonNode left, JsonNode right) {
        return switch (op) {
            case "==" -> equalsNode(left, right);
            case "!=" -> !equalsNode(left, right);
            case ">" -> cmp(left, right) > 0;
            case "<" -> cmp(left, right) < 0;
            case ">=" -> cmp(left, right) >= 0;
            case "<=" -> cmp(left, right) <= 0;
            case "in" -> inArray(right, left);
            case "contains" -> inArray(left, right);
            case "startsWith" -> left.isTextual() && right.isTextual() && left.asText().startsWith(right.asText());
            case "endsWith" -> left.isTextual() && right.isTextual() && left.asText().endsWith(right.asText());
            default -> false;
        };
    }

    private static boolean equalsNode(JsonNode a, JsonNode b) {
        if (a.isNull() || b.isNull()) {
            return a.isNull() && b.isNull();
        }
        if (a.isNumber() && b.isNumber()) {
            return a.asDouble() == b.asDouble();
        }
        return a.equals(b);
    }

    private static int cmp(JsonNode a, JsonNode b) {
        if (a.isNumber() && b.isNumber()) {
            return Double.compare(a.asDouble(), b.asDouble());
        }
        return a.asText().compareTo(b.asText());
    }

    private static boolean inArray(JsonNode array, JsonNode value) {
        if (array.isArray()) {
            for (JsonNode e : array) {
                if (equalsNode(e, value)) {
                    return true;
                }
            }
            return false;
        }
        if (array.isTextual()) {
            return array.asText().contains(value.asText());
        }
        return false;
    }

    // ------------------------------------------------------------------
    // Per-render state
    // ------------------------------------------------------------------

    private static final class LoopFrame {
        final String variable;
        final JsonNode item;
        final int index;
        final int count;
        /** {@code 0} for a plain {@code $CMS_FOR$} loop; nesting depth for a nav-recursion frame (exposed as {@code _depth}). */
        final int depth;
        /** {@code null} for a plain {@code $CMS_FOR$} loop; the block body to replay for a nav-recursion frame's children. */
        final List<OctlNode> body;

        LoopFrame(String variable, JsonNode item, int index, int count) {
            this(variable, item, index, count, 0, null);
        }

        LoopFrame(String variable, JsonNode item, int index, int count, int depth, List<OctlNode> body) {
            this.variable = variable;
            this.item = item;
            this.index = index;
            this.count = count;
            this.depth = depth;
            this.body = body;
        }
    }

    /** A block being rendered, and which of its definitions (0 = most derived). */
    private record BlockFrame(String name, int depth) {}

    /** A record set as one render sees it: its source, the records its stored query selects, and its root value object. */
    private record SetSelection(RecordSetSource source, List<RecordView> records, JsonNode value) {}

    private static final class State {
        final CompiledTemplate template;
        final RenderContext context;
        final StringBuilder out = new StringBuilder(4096);
        final Set<UUID> deps = new LinkedHashSet<>();
        final List<Diagnostic> warnings = new ArrayList<>();
        /** Reference keys already warned about as missing, so a loop emits one warning, not one per iteration. */
        final Set<String> missingTargets = new HashSet<>();
        final Deque<LoopFrame> loops = new ArrayDeque<>();
        final Deque<Map<String, JsonNode>> vars = new ArrayDeque<>();
        final Deque<BlockFrame> blocks = new ArrayDeque<>();
        /** Record sets selected in this render (M25.2.2), by set UUID: a set is selected once however often it is read. */
        final Map<UUID, SetSelection> sets = new HashMap<>();
        /** Reference-editor set loops whose argument fields were already checked in this render (by node identity). */
        final Map<OctlNode.For, Boolean> checkedLoops = new IdentityHashMap<>();
        final RenderBudget budget;

        State(CompiledTemplate template, RenderContext context, RenderBudget budget) {
            this.template = template;
            this.context = context;
            this.budget = budget;
        }

        void append(String s) {
            out.append(s);
            budget.chargeOutput(s.length());
        }

        /** Adds a warning unless this render already has it: a record set reports once, not once per record or read. */
        void warnOnce(Diagnostic warning) {
            if (!warnings.contains(warning)) {
                warnings.add(warning);
            }
        }

        /**
         * Appends a {@link BlockResolver}'s output. Nested renders sharing this budget have
         * already charged their own output, so only the remainder (markup the resolver produced
         * itself) is charged here — the page's output is counted once, however deeply nested.
         */
        void appendResolved(Supplier<String> resolverCall) {
            long before = budget.outputChars();
            String text = nullToEmpty(resolverCall.get());
            out.append(text);
            budget.chargeOutput(Math.max(0, text.length() - (budget.outputChars() - before)));
        }

        void pushLoop(LoopFrame frame) {
            loops.push(frame);
        }

        void popLoop() {
            loops.pop();
        }

        LoopFrame findLoop(String name) {
            for (LoopFrame frame : loops) {
                if (frame.variable.equals(name)) {
                    return frame;
                }
            }
            return null;
        }

        void setVar(String name, JsonNode value) {
            if (vars.isEmpty()) {
                vars.push(new LinkedHashMap<>());
            }
            vars.peek().put(name, value);
        }

        JsonNode findSet(String name) {
            for (Map<String, JsonNode> scope : vars) {
                if (scope.containsKey(name)) {
                    return scope.get(name);
                }
            }
            return null;
        }

        void collectDeps(JsonNode node) {
            if (node == null || node.isValueNode()) {
                return;
            }
            if (node.isObject()) {
                JsonNode uuid = node.get("uuid");
                if (uuid != null && uuid.isTextual()) {
                    try {
                        deps.add(UUID.fromString(uuid.asText()));
                    } catch (IllegalArgumentException ignore) {
                        // not a valid uuid value; skip
                    }
                }
                for (JsonNode child : node) {
                    collectDeps(child);
                }
            } else if (node.isArray()) {
                for (JsonNode child : node) {
                    collectDeps(child);
                }
            }
        }
    }
}
