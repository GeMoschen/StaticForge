package com.acme.staticforge.template.render;

import com.acme.staticforge.template.diagnostic.Diagnostic;
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
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

/**
 * Thread-safe, side-effect-free stack-machine renderer (spec §16.5, §16.10). Walks the
 * compiled AST against a {@link RenderContext}, producing output plus the set of touched
 * asset UUIDs. A fresh per-render {@link State} carries all mutable data, so a single
 * renderer instance is safe to share across concurrent virtual threads.
 *
 * <p>Guard rails throw {@link RenderLimitException} so a caller can fail the affected file
 * with a diagnostic rather than abort the whole build.
 */
public final class OctlRenderer implements Renderer {

    private static final int MAX_INCLUDE_DEPTH = 32;
    private static final int MAX_LOOP_ITERATIONS = 100_000;
    private static final int MAX_OUTPUT_BYTES = 32 * 1024 * 1024;
    private static final long TIME_BUDGET_NANOS = 5_000_000_000L;

    public OctlRenderer() {}

    @Override
    public RenderResult render(CompiledTemplate template, RenderContext context) {
        State s = new State(template, context);
        s.startNanos = System.nanoTime();
        renderNodes(template.nodes(), s);
        return new RenderResult(s.out.toString(), s.deps, s.warnings);
    }

    // ------------------------------------------------------------------
    // Node dispatch
    // ------------------------------------------------------------------

    private void renderNodes(List<OctlNode> nodes, State s) {
        for (OctlNode node : nodes) {
            s.checkTime();
            switch (node) {
                case OctlNode.Text t -> s.append(t.value());
                case OctlNode.Value v -> renderValue(v, s);
                case OctlNode.Ref r -> renderRef(r, s);
                case OctlNode.Body b -> renderBody(b, s);
                case OctlNode.Include i -> renderInclude(i, s);
                case OctlNode.Nav n -> renderNav(n, s);
                case OctlNode.NavRecurse nr -> renderNavRecurse(nr, s);
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
        s.append(resolver == null ? "" : nullToEmpty(resolver.renderBody(b.name())));
    }

    private void renderInclude(OctlNode.Include i, State s) {
        s.includeDepth++;
        if (s.includeDepth > MAX_INCLUDE_DEPTH) {
            throw new RenderLimitException(Diagnostic.error(
                    "SF-TPL-0130", "Include depth exceeded", i.line(), i.col()));
        }
        // Resolving the referenced template's UUID keeps it in the dependency set.
        noteReference(i.accessor(), s);
        BlockResolver resolver = s.context.blockResolver();
        if (resolver == null) {
            s.append(""); // full include rendering is deferred (needs the generation snapshot)
        } else {
            String uid = resolvedUid(i.accessor(), s);
            s.append(nullToEmpty(resolver.renderInclude(uid, namedArgs(i.args()))));
        }
        s.includeDepth--;
    }

    private void renderNav(OctlNode.Nav n, State s) {
        noteReference(n.accessor(), s);
        BlockResolver resolver = s.context.blockResolver();
        if (resolver == null) {
            s.append(""); // no resolver wired: renders empty
            return;
        }
        String uid = resolvedUid(n.accessor(), s);
        s.append(nullToEmpty(resolver.renderNav(uid, namedArgs(n.args()))));
    }

    private void renderNavRecurse(OctlNode.NavRecurse nr, State s) {
        BlockResolver resolver = s.context.blockResolver();
        if (resolver == null) {
            s.append("");
            return;
        }
        LoopFrame loop = s.findLoop(nr.variable());
        JsonNode node = loop == null ? MissingNode.getInstance() : loop.item;
        s.append(nullToEmpty(resolver.renderNavRecurse(node)));
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
        JsonNode list = resolve(f.accessor(), s);
        if (list == null || !list.isArray()) {
            return;
        }
        int count = list.size();
        for (int index = 0; index < count; index++) {
            s.loopIterations++;
            if (s.loopIterations > MAX_LOOP_ITERATIONS) {
                throw new RenderLimitException(Diagnostic.error(
                        "SF-TPL-0131", "Loop iteration limit exceeded", f.line(), f.col()));
            }
            s.pushLoop(new LoopFrame(f.variable(), list.get(index), index, count));
            try {
                renderNodes(f.body(), s);
            } finally {
                s.popLoop();
            }
        }
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
            // Cross-asset value rendering requires the generation snapshot; deferred.
            return MissingNode.getInstance();
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
                default -> resolveSub(loop.item, path, 1, s);
            };
        }
        JsonNode setValue = s.findSet(first);
        if (setValue != null) {
            return resolveSub(setValue, path, 1, s);
        }
        return resolveSub(s.context.values(), path, 0, s);
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

    private RefTarget resolveRefTarget(Accessor accessor, State s) {
        if (accessor.isAssetReference()) {
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

        LoopFrame(String variable, JsonNode item, int index, int count) {
            this.variable = variable;
            this.item = item;
            this.index = index;
            this.count = count;
        }
    }

    private static final class State {
        final CompiledTemplate template;
        final RenderContext context;
        final StringBuilder out = new StringBuilder(4096);
        final Set<UUID> deps = new LinkedHashSet<>();
        final List<Diagnostic> warnings = new ArrayList<>();
        final Deque<LoopFrame> loops = new ArrayDeque<>();
        final Deque<Map<String, JsonNode>> vars = new ArrayDeque<>();
        long startNanos;
        int includeDepth;
        int loopIterations;

        State(CompiledTemplate template, RenderContext context) {
            this.template = template;
            this.context = context;
        }

        void append(String s) {
            out.append(s);
            if (out.length() > MAX_OUTPUT_BYTES) {
                throw new RenderLimitException(Diagnostic.error(
                        "SF-TPL-0132", "Output size limit exceeded (32 MB)", 0, 0));
            }
        }

        void checkTime() {
            if (System.nanoTime() - startNanos > TIME_BUDGET_NANOS) {
                throw new RenderLimitException(Diagnostic.error(
                        "SF-TPL-0133", "Render time budget exceeded (5 s)", 0, 0));
            }
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
