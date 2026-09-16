package com.acme.staticforge.template.octl;

import static org.assertj.core.api.Assertions.assertThat;

import com.acme.staticforge.template.diagnostic.Diagnostic;
import com.acme.staticforge.template.diagnostic.DiagnosticCodes;
import com.acme.staticforge.template.diagnostic.Severity;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.Test;

/** {@link OctlCompiler#compileTextMedia}: the instruction policy and warnings for processed text media (M18.2.1). */
class OctlCompilerTextMediaTest {

    private final OctlCompiler compiler = new OctlCompiler();

    /** Resolves every reference except uid {@code nope}. */
    private static final ReferenceResolver RESOLVER = (type, uid) -> "nope".equals(uid)
            ? Optional.empty()
            : Optional.of(UUID.nameUUIDFromBytes((type + ":" + uid).getBytes()));

    @Test
    void cssWithGlobalsRefsAndLoopsCompilesCleanly() {
        String css = """
                a { color: $CMS_VALUE(global:site.brandColor)$; }
                $CMS_SET(bg = media:bg)$
                body { background: url($CMS_REF(media:bg)$); }
                $CMS_IF(global:site.dark)$html{filter:invert(1)}$CMS_END_IF$
                $CMS_FOR(item : nav:main)$/* $CMS_VALUE(item.label)$ */$CMS_END_FOR$
                $CMS_NAVIGATION(nav:main) as node$$CMS_VALUE(node.label)$$CMS_NAVIGATION_RECURSE(node)$$CMS_END_NAVIGATION$
                /* $CMS_META(channel)$ $CMS_META(mimeType)$ */
                $CMS_COMMENT$ dropped $CMS_END_COMMENT$
                """;

        OctlResult result = compiler.compileTextMedia(css, "html", RESOLVER, false);

        assertThat(result.diagnostics()).isEmpty();
        assertThat(result.template().references()).containsOnlyKeys("global:site", "media:bg", "nav:main");
    }

    @Test
    void pageOnlyInstructionsAreErrors() {
        assertThat(codes(compile("$CMS_BODY(main)$", false))).containsExactly(DiagnosticCodes.OCTL_NOT_ALLOWED_IN_TEXT_MEDIA);
        assertThat(codes(compile("$CMS_INCLUDE(section_template:x)$", false)))
                .containsExactly(DiagnosticCodes.OCTL_NOT_ALLOWED_IN_TEXT_MEDIA);
        assertThat(codes(compile("$CMS_NAVIGATION(nav:main)$", false)))
                .containsExactly(DiagnosticCodes.OCTL_NOT_ALLOWED_IN_TEXT_MEDIA);
        assertThat(codes(compile("$CMS_VALUE(CMS_PAGE.title)$", false)))
                .containsExactly(DiagnosticCodes.OCTL_NOT_ALLOWED_IN_TEXT_MEDIA);
        assertThat(compile("$CMS_BODY(main)$", false).hasErrors()).isTrue();
    }

    @Test
    void anIncludeInTextMediaResolvesNoReference() {
        OctlResult result = compile("$CMS_INCLUDE(section_template:x)$", false);

        assertThat(result.template().references()).isEmpty();
    }

    @Test
    void templateChecksStillApply() {
        assertThat(codes(compile("$CMS_VALUE(global:nope.title)$", false)))
                .containsExactly(DiagnosticCodes.OCTL_UNRESOLVABLE_REF);
        // No editors: a bare name is an unknown editor, not a silent blank.
        assertThat(codes(compile("$CMS_VALUE(brandColor)$", false))).containsExactly(DiagnosticCodes.OCTL_UNKNOWN_EDITOR);
        assertThat(codes(compile("$CMS_SET(c = global:site.brandColor)$$CMS_VALUE(c)$", false))).isEmpty();
        assertThat(codes(compile("$CMS_VALUE(CMS_GLOBAL)$", false))).containsExactly(DiagnosticCodes.OCTL_GLOBAL_REFERENCE_MISUSE);
        assertThat(codes(compile("$CMS_BOGUS$", false))).containsExactly(DiagnosticCodes.OCTL_UNKNOWN_INSTRUCTION);
    }

    @Test
    void everyDollarEscapeIsAWarningWithItsPosition() {
        String js = "const all = $$('a');\n  let x = $$;\n";

        OctlResult result = compile(js, true);

        assertThat(result.hasErrors()).isFalse();
        assertThat(result.diagnostics())
                .extracting(Diagnostic::code, Diagnostic::line, Diagnostic::column, Diagnostic::severity)
                .containsExactly(
                        org.assertj.core.groups.Tuple.tuple(DiagnosticCodes.OCTL_TEXT_MEDIA_DOLLAR_ESCAPE, 1, 13, Severity.WARNING),
                        org.assertj.core.groups.Tuple.tuple(DiagnosticCodes.OCTL_TEXT_MEDIA_DOLLAR_ESCAPE, 2, 11, Severity.WARNING));
    }

    @Test
    void dollarEscapesInsideCommentsAreNotReported() {
        String source = "$CMS_COMMENT$ $$ $CMS_END_COMMENT$ a$$ $CMS_COMMENT$\n$$ $CMS_END_COMMENT$";

        assertThat(compile(source, false).diagnostics())
                .extracting(Diagnostic::code, Diagnostic::column)
                .containsExactly(org.assertj.core.groups.Tuple.tuple(DiagnosticCodes.OCTL_TEXT_MEDIA_DOLLAR_ESCAPE, 37));
    }

    @Test
    void dollarEscapesAfterAnUnclosedCommentAreNotReported() {
        assertThat(codes(compile("$CMS_COMMENT$ $$", false))).containsExactly(DiagnosticCodes.OCTL_UNBALANCED_BLOCK);
    }

    @Test
    void templatesKeepTreatingDollarEscapesSilently() {
        assertThat(compiler.compile("$$", "html", RESOLVER).diagnostics()).isEmpty();
    }

    @Test
    void unescapedValuesWarnOnlyInScriptLikeFiles() {
        String json = "{\"title\": \"$CMS_VALUE(global:site.title)$\"}";

        assertThat(codes(compile(json, true))).containsExactly(DiagnosticCodes.OCTL_TEXT_MEDIA_UNESCAPED_VALUE);
        assertThat(codes(compile(json, false))).isEmpty();
        assertThat(codes(compile("{\"title\": $CMS_VALUE(global:site.title | json)$}", true))).isEmpty();
        assertThat(codes(compile("var t = '$CMS_VALUE(global:site.title | upper | js)$';", true))).isEmpty();
        assertThat(codes(compile("$CMS_FOR(i : nav:main)$$CMS_VALUE(i.label)$$CMS_END_FOR$", true)))
                .containsExactly(DiagnosticCodes.OCTL_TEXT_MEDIA_UNESCAPED_VALUE);
    }

    private OctlResult compile(String source, boolean scriptLike) {
        return compiler.compileTextMedia(source, "html", RESOLVER, scriptLike);
    }

    private static List<String> codes(OctlResult result) {
        return result.diagnostics().stream().map(Diagnostic::code).toList();
    }
}
