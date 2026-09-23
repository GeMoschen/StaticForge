package com.acme.staticforge.template.octl;

import static org.assertj.core.api.Assertions.assertThat;

import com.acme.staticforge.template.cdl.CdlCompiler;
import com.acme.staticforge.template.content.ContentDefinition;
import com.acme.staticforge.template.diagnostic.Diagnostic;
import com.acme.staticforge.template.diagnostic.DiagnosticCodes;
import com.acme.staticforge.template.diagnostic.Severity;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.Test;

/** {@link OctlCompiler#compileRecordTemplate}: a dataset's per-channel record template (M25.2.1). */
class OctlCompilerRecordTemplateTest {

    private static final ContentDefinition TEAM = new CdlCompiler().compile("""
            content {
              editor text name { label "Name" }
              editor text role { label "Role" }
              editor number level { label "Level" }
              editor list links { label "Links" item { editor text url { label "URL" } } }
            }
            """).definition();

    /** Resolves every reference except uid {@code nope}. */
    private static final ReferenceResolver RESOLVER = (type, uid) -> "nope".equals(uid)
            ? Optional.empty()
            : Optional.of(UUID.nameUUIDFromBytes((type + ":" + uid).getBytes()));

    private final OctlCompiler compiler = new OctlCompiler();

    @Test
    void fieldsMetaAndPositionAreTopLevelNames() {
        String source = """
                <li class="$CMS_IF(_first)$first$CMS_END_IF$$CMS_IF(_last)$ last$CMS_END_IF$" data-i="$CMS_VALUE(_index)$">
                  $CMS_VALUE(name)$ ($CMS_VALUE(_index)$ of $CMS_VALUE(_count)$) $CMS_VALUE(_uid)$ $CMS_VALUE(_uuid)$
                  $CMS_VALUE(_displayName)$ $CMS_VALUE(_recordSet)$ $CMS_VALUE(_folderPath)$ $CMS_VALUE(_changedAt)$
                  $CMS_VALUE(_meta.uid)$ $CMS_VALUE(CMS_PAGE.title)$
                  $CMS_FOR(link : links)$<a href="$CMS_VALUE(link.url)$">x</a>$CMS_END_FOR$
                  $CMS_SET(label = role)$$CMS_VALUE(label)$
                </li>
                """;

        OctlResult result = compiler.compileRecordTemplate(source, "html", RESOLVER, TEAM);

        assertThat(result.diagnostics()).isEmpty();
        assertThat(result.template().channelKey()).isEqualTo("html");
    }

    @Test
    void anUndeclaredFieldIsAnUnknownEditorAtItsPosition() {
        OctlResult result = compiler.compileRecordTemplate("<p>\n  $CMS_VALUE(email)$\n</p>", "html", RESOLVER, TEAM);

        assertThat(result.hasErrors()).isTrue();
        Diagnostic diagnostic = result.diagnostics().getFirst();
        assertThat(diagnostic.code()).isEqualTo(DiagnosticCodes.OCTL_UNKNOWN_EDITOR);
        assertThat(diagnostic.line()).isEqualTo(2);
        assertThat(diagnostic.column()).isEqualTo(3);
    }

    @Test
    void unusedFieldsAreNotReported() {
        OctlResult result = compiler.compileRecordTemplate("$CMS_VALUE(name)$", "md", RESOLVER, TEAM);

        assertThat(codes(result)).doesNotContain(DiagnosticCodes.OCTL_EDITOR_NEVER_USED);
        assertThat(result.diagnostics()).isEmpty();
    }

    @Test
    void theSameSourceAsASectionTemplateWouldWarnAboutUnusedEditors() {
        OctlResult section = compiler.compile("$CMS_VALUE(name)$", "html", RESOLVER, TEAM);

        assertThat(codes(section)).contains(DiagnosticCodes.OCTL_EDITOR_NEVER_USED);
    }

    @Test
    void positionNamesAreNotKnownOutsideARecordTemplate() {
        OctlResult section = compiler.compile("$CMS_VALUE(_index)$", "html", RESOLVER, TEAM);

        assertThat(codes(section)).contains(DiagnosticCodes.OCTL_UNKNOWN_EDITOR);
    }

    @Test
    void bodiesAndInheritanceAreErrors() {
        assertThat(codes(compile("$CMS_BODY(main)$"))).containsExactly(DiagnosticCodes.OCTL_NOT_ALLOWED_IN_RECORD_TEMPLATE);
        assertThat(codes(compile("$CMS_EXTENDS(page_template:base)$$CMS_BLOCK(main)$x$CMS_END_BLOCK$")))
                .containsExactly(
                        DiagnosticCodes.OCTL_NOT_ALLOWED_IN_RECORD_TEMPLATE,
                        DiagnosticCodes.OCTL_NOT_ALLOWED_IN_RECORD_TEMPLATE);
        assertThat(codes(compile("$CMS_BLOCK(card)$$CMS_VALUE(name)$$CMS_END_BLOCK$")))
                .containsExactly(DiagnosticCodes.OCTL_NOT_ALLOWED_IN_RECORD_TEMPLATE);
        assertThat(codes(compile("$CMS_BLOCK(card)$$CMS_PARENT$$CMS_END_BLOCK$")))
                .containsExactly(
                        DiagnosticCodes.OCTL_NOT_ALLOWED_IN_RECORD_TEMPLATE,
                        DiagnosticCodes.OCTL_NOT_ALLOWED_IN_RECORD_TEMPLATE);
    }

    @Test
    void aBodyIsRejectedWhereverItAppearsWithItsPosition() {
        OctlResult result = compile("<div>\n$CMS_IF(name)$$CMS_BODY(x)$$CMS_END_IF$</div>");

        assertThat(result.hasErrors()).isTrue();
        Diagnostic diagnostic = result.diagnostics().getFirst();
        assertThat(diagnostic.code()).isEqualTo(DiagnosticCodes.OCTL_NOT_ALLOWED_IN_RECORD_TEMPLATE);
        assertThat(diagnostic.severity()).isEqualTo(Severity.ERROR);
        assertThat(diagnostic.line()).isEqualTo(2);
        assertThat(diagnostic.message()).contains("$CMS_BODY");
    }

    @Test
    void namesInsideARejectedBlockAreStillChecked() {
        assertThat(codes(compile("$CMS_BLOCK(card)$$CMS_VALUE(nope)$$CMS_END_BLOCK$")))
                .containsExactlyInAnyOrder(
                        DiagnosticCodes.OCTL_NOT_ALLOWED_IN_RECORD_TEMPLATE, DiagnosticCodes.OCTL_UNKNOWN_EDITOR);
    }

    @Test
    void referencesResolveAndAreRecordedLikeATemplatesReferences() {
        OctlResult result = compile("<a href=\"$CMS_REF(page:home)$\">$CMS_VALUE(name)$</a> $CMS_VALUE(page:nope.title)$");

        assertThat(codes(result)).containsExactly(DiagnosticCodes.OCTL_UNRESOLVABLE_REF);
        assertThat(result.template().references()).containsOnlyKeys("page:home");
        assertThat(result.template().referenceUses()).containsKey("page:home");
    }

    @Test
    void aDatasetLoopInsideARecordTemplateIsCompiledAsUsual() {
        OctlResult result = compile("$CMS_FOR(m : dataset:team, where=\"m.level > 2\")$$CMS_VALUE(m.name)$$CMS_END_FOR$");

        assertThat(result.diagnostics()).isEmpty();
        assertThat(result.template().datasetQueries("team")).hasSize(1);
    }

    @Test
    void withoutADefinitionNamesAreNotChecked() {
        OctlResult result = compiler.compileRecordTemplate("$CMS_VALUE(anything)$ $CMS_BODY(x)$", "html", RESOLVER, null);

        assertThat(codes(result)).containsExactly(DiagnosticCodes.OCTL_NOT_ALLOWED_IN_RECORD_TEMPLATE);
    }

    private OctlResult compile(String source) {
        return compiler.compileRecordTemplate(source, "html", RESOLVER, TEAM);
    }

    private static List<String> codes(OctlResult result) {
        return result.diagnostics().stream().map(Diagnostic::code).toList();
    }
}
