package com.acme.staticforge.template.octl;

import com.acme.staticforge.template.content.ContentDefinition;
import com.acme.staticforge.template.content.EditorType;
import com.acme.staticforge.template.diagnostic.Diagnostic;
import com.acme.staticforge.template.diagnostic.DiagnosticCodes;
import com.acme.staticforge.template.query.DatasetQuery;
import com.acme.staticforge.template.query.DatasetQueryParser;
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

    /** The {@code assetType:uid} prefix of a dataset loop source (M19.3.2). */
    private static final String DATASET_PREFIX = "dataset";

    /** The {@code assetType:uid} prefix of a single record (M19.3.2). */
    private static final String RECORD_PREFIX = "record";

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
        return compile(source, channelKey, references, contentDef, null);
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

    private OctlResult compile(
            String source,
            String channelKey,
            ReferenceResolver references,
            ContentDefinition contentDef,
            TextMedia textMedia) {
        String text = source == null ? "" : source;
        String channel = channelKey == null ? "html" : channelKey;

        OctlLexer.LexResult lexed = new OctlLexer().lex(text);
        OctlParser.ParseResult parsed = new OctlParser(lexed.tokens()).parse();

        List<Diagnostic> diagnostics = new ArrayList<>(lexed.diagnostics());
        diagnostics.addAll(parsed.diagnostics());

        Map<String, UUID> refMap = new LinkedHashMap<>();
        ValidateCtx ctx = new ValidateCtx(references, contentDef, refMap, diagnostics, textMedia);
        validate(parsed.nodes(), new HashSet<>(), ctx);

        ctx.emitDeclaredNeverUsed();
        if (textMedia != null) {
            warnDollarEscapes(lexed, diagnostics);
        }

        String hash = sha256(channel + '\u0000' + text);
        CompiledTemplate template = new CompiledTemplate(
                channel,
                hash,
                parsed.nodes(),
                refMap,
                ReferenceUseCollector.collect(parsed.nodes(), ctx.datasetQueries),
                ctx.datasetQueries);
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
                    checkTextMediaEscaping(v, ctx);
                }
                case OctlNode.Ref r -> {
                    checkAccessorRoot(r.accessor(), shadowed, r.line(), r.col(), ctx);
                    checkRefHasUrl(r.accessor(), r.line(), r.col(), ctx);
                }
                case OctlNode.Body b -> {
                    if (ctx.textMedia != null) {
                        notInTextMedia("$CMS_BODY", b.line(), b.col(), ctx);
                    } else {
                        checkBody(b, ctx);
                    }
                }
                case OctlNode.Include i -> {
                    if (ctx.textMedia != null) {
                        notInTextMedia("$CMS_INCLUDE", i.line(), i.col(), ctx);
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
                    }
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
        if ("CMS_PAGE".equals(name)) {
            if (ctx.textMedia != null) {
                notInTextMedia("CMS_PAGE", line, col, ctx);
            }
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

    /**
     * A property set has no URL of its own, so {@code $CMS_REF(CMS_GLOBAL.site)$} (or the
     * equivalent {@code global:site}) can only ever render empty. The value path is what carries
     * the link — {@code $CMS_REF(CMS_GLOBAL.site.logo)$} refs the media the {@code logo} editor
     * holds — so the path-less form is a compile error rather than a silent blank (M17.3.1).
     * Records and datasets (M19.3.2) have no URL either.
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
        } else if (DATASET_PREFIX.equals(accessor.assetType()) || RECORD_PREFIX.equals(accessor.assetType())) {
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

        UUID dataset = ctx.refMap.get(loop.accessor().referenceKey());
        if (dataset != null && ctx.references != null) {
            ctx.references.datasetDefinition(dataset).ifPresent(definition -> ctx.diagnostics.addAll(
                    DatasetQueryParser.validateFields(parsed.query(), definition, loop.line(), loop.col())));
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

    private static void notInTextMedia(String what, int line, int col, ValidateCtx ctx) {
        ctx.diagnostics.add(Diagnostic.error(
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

        ValidateCtx(
                ReferenceResolver references,
                ContentDefinition contentDef,
                Map<String, UUID> refMap,
                List<Diagnostic> diagnostics,
                TextMedia textMedia) {
            this.references = references;
            this.contentDef = contentDef;
            this.refMap = refMap;
            this.diagnostics = diagnostics;
            this.textMedia = textMedia;
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
