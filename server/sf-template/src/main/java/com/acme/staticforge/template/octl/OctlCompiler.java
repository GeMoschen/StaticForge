package com.acme.staticforge.template.octl;

import com.acme.staticforge.template.content.ContentDefinition;
import com.acme.staticforge.template.content.EditorType;
import com.acme.staticforge.template.diagnostic.Diagnostic;
import com.acme.staticforge.template.diagnostic.DiagnosticCodes;
import com.acme.staticforge.template.render.Filters;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
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
        String text = source == null ? "" : source;
        String channel = channelKey == null ? "html" : channelKey;

        OctlLexer.LexResult lexed = new OctlLexer().lex(text);
        OctlParser.ParseResult parsed = new OctlParser(lexed.tokens()).parse();

        List<Diagnostic> diagnostics = new ArrayList<>(lexed.diagnostics());
        diagnostics.addAll(parsed.diagnostics());

        Map<String, UUID> refMap = new LinkedHashMap<>();
        ValidateCtx ctx = new ValidateCtx(references, contentDef, refMap, diagnostics);
        validate(parsed.nodes(), new HashSet<>(), ctx);

        ctx.emitDeclaredNeverUsed();

        String hash = sha256(channel + '\u0000' + text);
        CompiledTemplate template = new CompiledTemplate(channel, hash, parsed.nodes(), refMap);
        return new OctlResult(template, diagnostics);
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
                }
                case OctlNode.Ref r -> checkAccessorRoot(r.accessor(), shadowed, r.line(), r.col(), ctx);
                case OctlNode.Body b -> checkBody(b, ctx);
                case OctlNode.Include i -> resolveReference(i.accessor(), i.line(), i.col(), ctx);
                case OctlNode.Navigation nav -> {
                    resolveReference(nav.accessor(), nav.line(), nav.col(), ctx);
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
                    Set<String> inner = new HashSet<>(shadowed);
                    inner.add(f.variable());
                    validate(f.body(), inner, ctx);
                }
                case OctlNode.Set st -> {
                    validateExpr(st.expr(), shadowed, ctx);
                    shadowed.add(st.name());
                }
                case OctlNode.Meta m -> checkFilters(m.filters(), m.line(), m.col(), ctx);
                case OctlNode.Comment c -> { /* nothing */ }
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
        if ("CMS_PAGE".equals(name) || shadowed.contains(name)) {
            return;
        }
        if (ctx.contentDef.findEditor(name).isPresent()) {
            ctx.usedEditors.add(name);
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
        if (accessor.isAssetReference() && accessor.path().isEmpty()) {
            ctx.diagnostics.add(Diagnostic.warning(
                    DiagnosticCodes.OCTL_CROSS_ASSET_VALUE_WITHOUT_PATH,
                    "Cross-asset value without an editor path: " + accessor.referenceKey()
                            + " (did you mean " + accessor.referenceKey() + ".editorName?)",
                    line, col));
        }
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

    private void checkBody(OctlNode.Body body, ValidateCtx ctx) {
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

    private static final class ValidateCtx {
        final ReferenceResolver references;
        final ContentDefinition contentDef;
        final Map<String, UUID> refMap;
        final List<Diagnostic> diagnostics;
        final Set<String> usedEditors = new HashSet<>();
        final Set<String> usedBodies = new HashSet<>();

        ValidateCtx(
                ReferenceResolver references,
                ContentDefinition contentDef,
                Map<String, UUID> refMap,
                List<Diagnostic> diagnostics) {
            this.references = references;
            this.contentDef = contentDef;
            this.refMap = refMap;
            this.diagnostics = diagnostics;
        }

        void emitDeclaredNeverUsed() {
            if (contentDef == null) {
                return;
            }
            for (var body : contentDef.bodies()) {
                if (!usedBodies.contains(body.name())) {
                    diagnostics.add(Diagnostic.warning(
                            DiagnosticCodes.OCTL_BODY_NEVER_RENDERED,
                            "Body declared but never rendered: " + body.name(), 0, 0));
                }
            }
            for (var editor : contentDef.editors()) {
                if (editor.isGroup() || editor.name().startsWith("_group_")) {
                    continue;
                }
                if (!usedEditors.contains(editor.name())) {
                    diagnostics.add(Diagnostic.warning(
                            DiagnosticCodes.OCTL_EDITOR_NEVER_USED,
                            "Editor declared but never used in this template: " + editor.name(), 0, 0));
                }
            }
        }
    }
}
