package com.acme.staticforge.template.render;

import com.acme.staticforge.template.diagnostic.Diagnostic;
import com.acme.staticforge.template.diagnostic.DiagnosticCodes;
import com.acme.staticforge.template.octl.Accessor;
import com.acme.staticforge.template.octl.CompiledTemplate;
import com.acme.staticforge.template.octl.Expr;
import com.acme.staticforge.template.octl.FilterNode;
import com.acme.staticforge.template.octl.NamedArg;
import com.acme.staticforge.template.octl.OctlNode;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.BooleanNode;
import com.fasterxml.jackson.databind.node.IntNode;
import com.fasterxml.jackson.databind.node.MissingNode;
import java.util.ArrayList;
import java.util.Deque;
import java.util.ArrayDeque;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.function.Supplier;

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
        renderNodes(template.nodes(), s);
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
            }
        }
    }

    private void renderValue(OctlNode.Value v, State s) {
        JsonNode value = resolve(v.accessor(), s);
        s.collectDeps(value);
        if (isCatalog(value)) {
            renderCatalogValue(value, s);
            return;
        }
        s.append(applyFilters(value, v.filters(), s));
    }

    private void renderMeta(OctlNode.Meta m, State s) {
        JsonNode value = resolveMeta(m.accessor(), s);
        s.append(applyFilters(value, m.filters(), s));
    }

    private void renderRef(OctlNode.Ref r, State s) {
        RefTarget target = resolveRefTarget(r.accessor(), s);
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
        JsonNode list = resolveForList(f.accessor(), f.args(), s);
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
     * top-level children from {@link BlockResolver#resolveNavigationChildren}; every other accessor
     * (including a cross-asset {@code page:uid.list}) goes through the normal {@link #resolve} path.
     */
    private JsonNode resolveForList(Accessor accessor, List<NamedArg> args, State s) {
        if (accessor.isAssetReference() && "nav".equals(accessor.assetType())) {
            noteReference(accessor, s);
            UUID navFolderUuid = s.template.references().get(accessor.referenceKey());
            if (navFolderUuid == null) {
                return null;
            }
            BlockResolver resolver = s.context.blockResolver();
            return resolver == null ? null : resolver.resolveNavigationChildren(navFolderUuid, namedArgs(args));
        }
        return resolve(accessor, s);
    }

    private void renderSet(OctlNode.Set st, State s) {
        JsonNode value = eval(st.expr(), s);
        if (value == null) {
            value = MissingNode.getInstance();
        }
        s.setVar(st.name(), value);
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
            value = filter.apply(value, f.args());
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
        JsonNode root = resolver.valueOf(accessor.assetType(), uuid);
        if (root == null || root.isMissingNode()) {
            if (s.missingTargets.add(accessor.referenceKey())) {
                s.warnings.add(Diagnostic.warning(
                        DiagnosticCodes.OCTL_MISSING_VALUE_TARGET,
                        "Cross-asset value target is missing or deleted: " + accessor.referenceKey(), 0, 0));
            }
            return MissingNode.getInstance();
        }
        return resolveSub(root, accessor.path(), 0, s);
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
            if (node == null || node.isMissingNode() || node.isNull() || !node.isObject()) {
                return MissingNode.getInstance();
            }
            node = node.get(path.get(i));
            if (node == null) {
                return MissingNode.getInstance();
            }
        }
        return node == null ? MissingNode.getInstance() : node;
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
    private RefTarget resolveRefTarget(Accessor accessor, State s) {
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
        JsonNode value = resolve(accessor, s);
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
                yield pipe(v, a.filters());
            }
            case Expr.Group g -> eval(g.inner(), s);
            case Expr.Not n -> BooleanNode.valueOf(!truthy(eval(n.operand(), s)));
            case Expr.And a -> BooleanNode.valueOf(truthy(eval(a.left(), s)) && truthy(eval(a.right(), s)));
            case Expr.Or o -> BooleanNode.valueOf(truthy(eval(o.left(), s)) || truthy(eval(o.right(), s)));
            case Expr.Cmp c -> BooleanNode.valueOf(compare(c.operator(), eval(c.left(), s), eval(c.right(), s)));
        };
    }

    private JsonNode pipe(JsonNode value, List<FilterNode> filters) {
        for (FilterNode f : filters) {
            Filter filter = Filters.lookup(f.name());
            if (filter == null) {
                continue;
            }
            value = filter.apply(value, f.args());
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
