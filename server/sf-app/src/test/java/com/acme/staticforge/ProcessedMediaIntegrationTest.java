package com.acme.staticforge;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.acme.staticforge.asset.AssetService;
import com.acme.staticforge.asset.AssetType;
import com.acme.staticforge.asset.AssetVersionView;
import com.acme.staticforge.asset.ReferenceKind;
import com.acme.staticforge.asset.UidChangeResult;
import com.acme.staticforge.asset.UsageView;
import com.acme.staticforge.asset.globals.CreateGlobalSetCommand;
import com.acme.staticforge.asset.globals.GlobalSetService;
import com.acme.staticforge.asset.globals.GlobalSetView;
import com.acme.staticforge.asset.media.MediaService;
import com.acme.staticforge.asset.media.MediaText;
import com.acme.staticforge.asset.media.MediaWriteResult;
import com.acme.staticforge.common.SfException;
import com.acme.staticforge.exportimport.ImportOptions;
import com.acme.staticforge.exportimport.ProjectExportImportService;
import com.acme.staticforge.project.CreateProjectRequest;
import com.acme.staticforge.project.Project;
import com.acme.staticforge.project.ProjectService;
import com.acme.staticforge.revision.AssetDiff;
import com.acme.staticforge.revision.DiffService;
import com.acme.staticforge.revision.FieldChange;
import com.acme.staticforge.revision.RevisionContext;
import com.acme.staticforge.revision.RevisionRepository;
import com.acme.staticforge.template.diagnostic.Diagnostic;
import com.acme.staticforge.template.diagnostic.DiagnosticCodes;
import com.acme.staticforge.user.AppUser;
import com.acme.staticforge.user.UserService;
import java.awt.Color;
import java.awt.image.BufferedImage;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.concurrent.atomic.AtomicInteger;
import javax.imageio.ImageIO;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;

/**
 * Processed text media at the service level (M18.1.1, M18.1.2, M18.2.1): the {@code processCms} flag,
 * text reads and writes, compile-on-save and the reference edges a processed source writes. HTTP
 * shapes and roles are {@code MediaTextApiTest}'s.
 */
@SpringBootTest
@ActiveProfiles("test")
class ProcessedMediaIntegrationTest {

    private static final AtomicInteger SEQ = new AtomicInteger();

    @Autowired UserService userService;
    @Autowired ProjectService projectService;
    @Autowired AssetService assetService;
    @Autowired MediaService mediaService;
    @Autowired GlobalSetService globalSetService;
    @Autowired RevisionRepository revisionRepository;
    @Autowired DiffService diffService;
    @Autowired ProjectExportImportService exportImportService;

    // ------------------------------------------------------------------
    // M18.1.1 — the flag
    // ------------------------------------------------------------------

    @Test
    void togglingTheFlagOnACssFileIsOneRevisionChangingOneField() {
        Fixture fx = newFixture();
        AssetVersionView css = upload(fx, "site.css", "a{color:red}");
        assertThat(css.payload().path("processCms").asBoolean(true)).isFalse();
        int before = revisionCount(fx);

        MediaWriteResult on = mediaService.setProcessCms(css.uuid(), true, css.validFromRevision(), fx.ctx());

        assertThat(on.media().payload().path("processCms").asBoolean()).isTrue();
        assertThat(revisionCount(fx)).isEqualTo(before + 1);
        AssetDiff diff = diffService.diff(fx.project().getId(), on.media().validFromRevision()).assets().get(0);
        assertThat(diff.changes()).extracting(FieldChange::path).containsExactly("processCms");

        MediaWriteResult off = mediaService.setProcessCms(css.uuid(), false, on.media().validFromRevision(), fx.ctx());
        assertThat(off.media().payload().path("processCms").asBoolean(true)).isFalse();
        assertThat(revisionCount(fx)).isEqualTo(before + 2);
    }

    @Test
    void settingTheValueTheFlagAlreadyHasWritesNoRevisionButStillRejectsAStaleClient() {
        Fixture fx = newFixture();
        AssetVersionView css = upload(fx, "site.css", "a{color:red}");
        int before = revisionCount(fx);

        MediaWriteResult same = mediaService.setProcessCms(css.uuid(), false, css.validFromRevision(), fx.ctx());

        assertThat(same.media().validFromRevision()).isEqualTo(css.validFromRevision());
        assertThat(revisionCount(fx)).isEqualTo(before);
        assertThatThrownBy(() -> mediaService.setProcessCms(css.uuid(), false, css.validFromRevision() - 1, fx.ctx()))
                .isInstanceOfSatisfying(SfException.class, e -> assertThat(e.getStatus()).isEqualTo(409));
    }

    @Test
    void binaryFilesCannotBeProcessedOrReadAsText() {
        Fixture fx = newFixture();
        AssetVersionView png = mediaService.upload(fx.project().getId(), null, "logo.png", "image/png", png(), fx.ctx());
        int before = revisionCount(fx);

        assertThatThrownBy(() -> mediaService.setProcessCms(png.uuid(), true, png.validFromRevision(), fx.ctx()))
                .isInstanceOfSatisfying(SfException.class, e -> assertThat(e.getStatus()).isEqualTo(400));
        assertThatThrownBy(() -> mediaService.readText(fx.project().getId(), png.uuid(), null))
                .isInstanceOfSatisfying(SfException.class, e -> assertThat(e.getStatus()).isEqualTo(400));
        assertThatThrownBy(() -> mediaService.writeText(png.uuid(), "x", png.validFromRevision(), fx.ctx()))
                .isInstanceOfSatisfying(SfException.class, e -> assertThat(e.getStatus()).isEqualTo(400));
        assertThat(revisionCount(fx)).isEqualTo(before);
    }

    @Test
    void replaceKeepsTheFlagForTextAndClearsItForABinary() {
        Fixture fx = newFixture();
        AssetVersionView css = processed(fx, upload(fx, "site.css", "a{color:red}"));

        MediaWriteResult stillCss = mediaService.replace(
                css.uuid(), "site.css", "text/css", "b{color:blue}".getBytes(StandardCharsets.UTF_8), fx.ctx());
        assertThat(stillCss.media().payload().path("processCms").asBoolean()).isTrue();
        assertThat(stillCss.processCmsCleared()).isFalse();

        MediaWriteResult nowPng = mediaService.replace(css.uuid(), "site.png", "image/png", png(), fx.ctx());
        assertThat(nowPng.media().payload().path("processCms").asBoolean(true)).isFalse();
        assertThat(nowPng.processCmsCleared()).isTrue();
    }

    @Test
    void replaceOfAProcessedFileCompilesTheNewFile() {
        Fixture fx = newFixture();
        AssetVersionView css = processed(fx, upload(fx, "site.css", "a{color:red}"));
        int before = revisionCount(fx);

        assertThatThrownBy(() -> mediaService.replace(css.uuid(), "site.css", "text/css",
                        "$CMS_BODY(main)$".getBytes(StandardCharsets.UTF_8), fx.ctx()))
                .isInstanceOfSatisfying(SfException.class, e -> assertThat(codes(e))
                        .containsExactly(DiagnosticCodes.OCTL_NOT_ALLOWED_IN_TEXT_MEDIA));
        assertThat(revisionCount(fx)).isEqualTo(before);
    }

    @Test
    void restoringAnOlderRevisionRestoresTheOlderFlag() {
        Fixture fx = newFixture();
        AssetVersionView css = upload(fx, "site.css", "a{color:red}");
        AssetVersionView on = processed(fx, css);

        AssetVersionView restored = assetService.restore(css.uuid(), css.validFromRevision(), fx.ctx());

        assertThat(on.payload().path("processCms").asBoolean()).isTrue();
        assertThat(restored.payload().path("processCms").asBoolean(true)).isFalse();
    }

    @Test
    void exportImportKeepsTheFlagAndRebuildsTheSourceEdges() {
        Fixture source = newFixture();
        GlobalSetView site = siteSet(source);
        AssetVersionView css = processed(source, upload(source, "site.css", "a{color:$CMS_VALUE(global:site.brandColor)$}"));

        byte[] archive = exportImportService.exportProject(source.project().getId());
        Fixture target = newFixture();
        exportImportService.importProject(target.project().getId(), archive, target.ctx(), ImportOptions.DEFAULT);

        AssetVersionView imported = assetService.requireCurrent(target.project().getId(), css.uuid());
        assertThat(imported.payload().path("processCms").asBoolean()).isTrue();
        assertThat(mediaService.readText(target.project().getId(), css.uuid(), null).text())
                .isEqualTo("a{color:$CMS_VALUE(global:site.brandColor)$}");
        assertThat(assetService.usages(target.project().getId(), site.uuid()))
                .extracting(UsageView::fromUuid, UsageView::kind, UsageView::sourcePath)
                .containsExactly(org.assertj.core.groups.Tuple.tuple(css.uuid(), ReferenceKind.OCTL_VALUE, "source"));
    }

    // ------------------------------------------------------------------
    // M18.1.2 — text content
    // ------------------------------------------------------------------

    @Test
    void readTextReturnsTheExactContentAndItsRevision() {
        Fixture fx = newFixture();
        String content = "\uFEFFa {\r\n  color: red;\n}\n";
        AssetVersionView css = upload(fx, "site.css", content);

        MediaText text = mediaService.readText(fx.project().getId(), css.uuid(), null);

        assertThat(text.text()).isEqualTo(content);
        assertThat(text.mimeType()).isEqualTo("text/css");
        assertThat(text.revision()).isEqualTo(css.validFromRevision());
        assertThat(text.utf8()).isTrue();
    }

    @Test
    void writeTextIsOneRevisionAndKeepsEverythingButTheBlob() {
        Fixture fx = newFixture();
        AssetVersionView css = processed(fx, upload(fx, "site.css", "a{color:red}"));
        css = mediaService.updateMetadata(css.uuid(), "alt", null, null, null, css.validFromRevision(), fx.ctx());
        String oldSha = css.payload().path("blobSha256").asText();
        int before = revisionCount(fx);

        MediaWriteResult written = mediaService.writeText(css.uuid(), "a{color:blue}\r\n", css.validFromRevision(), fx.ctx());

        assertThat(revisionCount(fx)).isEqualTo(before + 1);
        AssetVersionView saved = written.media();
        assertThat(saved.payload().path("blobSha256").asText()).isNotEqualTo(oldSha);
        assertThat(saved.payload().path("sizeBytes").asLong()).isEqualTo(15);
        assertThat(saved.payload().path("processCms").asBoolean()).isTrue();
        assertThat(saved.payload().path("altText").asText()).isEqualTo("alt");
        assertThat(saved.payload().path("fileName").asText()).isEqualTo("site.css");
        assertThat(saved.payload().path("mimeType").asText()).isEqualTo("text/css");
        assertThat(mediaService.readText(fx.project().getId(), css.uuid(), null).text()).isEqualTo("a{color:blue}\r\n");
        // The previous blob is history, still readable at its revision.
        assertThat(new String(mediaService.binary(fx.project().getId(), css.uuid(), null, css.validFromRevision()).bytes(),
                StandardCharsets.UTF_8)).isEqualTo("a{color:red}");
        AssetDiff diff = diffService.diff(fx.project().getId(), saved.validFromRevision()).assets().get(0);
        assertThat(diff.changes()).extracting(FieldChange::path).containsExactlyInAnyOrder("blobSha256", "sizeBytes");
    }

    @Test
    void aStaleWriteIsAConflictAndChangesNothing() {
        Fixture fx = newFixture();
        AssetVersionView css = upload(fx, "site.css", "a{color:red}");
        long stale = css.validFromRevision();
        mediaService.writeText(css.uuid(), "a{color:green}", stale, fx.ctx());
        int before = revisionCount(fx);

        assertThatThrownBy(() -> mediaService.writeText(css.uuid(), "a{color:blue}", stale, fx.ctx()))
                .isInstanceOfSatisfying(SfException.class, e -> assertThat(e.getStatus()).isEqualTo(409));
        assertThat(revisionCount(fx)).isEqualTo(before);
        assertThat(mediaService.readText(fx.project().getId(), css.uuid(), null).text()).isEqualTo("a{color:green}");
    }

    @Test
    void identicalContentWritesNoRevision() {
        Fixture fx = newFixture();
        AssetVersionView css = upload(fx, "site.css", "a{color:red}");
        int before = revisionCount(fx);

        MediaWriteResult same = mediaService.writeText(css.uuid(), "a{color:red}", css.validFromRevision(), fx.ctx());

        assertThat(same.media().validFromRevision()).isEqualTo(css.validFromRevision());
        assertThat(revisionCount(fx)).isEqualTo(before);
        assertThatThrownBy(() -> mediaService.writeText(css.uuid(), "a{color:red}", css.validFromRevision() - 1, fx.ctx()))
                .isInstanceOfSatisfying(SfException.class, e -> assertThat(e.getStatus()).isEqualTo(409));
    }

    @Test
    void svgTextIsSanitizedLikeAnUpload() {
        Fixture fx = newFixture();
        AssetVersionView svg = upload(fx, "icon.svg", "<svg xmlns=\"http://www.w3.org/2000/svg\"></svg>");

        mediaService.writeText(svg.uuid(),
                "<svg xmlns=\"http://www.w3.org/2000/svg\"><script>alert(1)</script><rect onclick=\"x()\"/></svg>",
                svg.validFromRevision(), fx.ctx());

        String stored = mediaService.readText(fx.project().getId(), svg.uuid(), null).text();
        assertThat(stored).doesNotContain("<script", "onclick").contains("<rect");
    }

    @Test
    void aFileThatIsNotUtf8IsReadWithReplacementAndFlagged() {
        Fixture fx = newFixture();
        byte[] latin1 = "café".getBytes(StandardCharsets.ISO_8859_1);
        AssetVersionView txt = mediaService.upload(fx.project().getId(), null, "notes.txt", "text/plain", latin1, fx.ctx());

        MediaText text = mediaService.readText(fx.project().getId(), txt.uuid(), null);

        assertThat(text.utf8()).isFalse();
        assertThat(text.text()).isEqualTo("caf\uFFFD");
    }

    @Test
    void readTextAtAnOlderRevisionReturnsThatContent() {
        Fixture fx = newFixture();
        AssetVersionView css = upload(fx, "site.css", "a{color:red}");
        mediaService.writeText(css.uuid(), "a{color:blue}", css.validFromRevision(), fx.ctx());

        MediaText old = mediaService.readText(fx.project().getId(), css.uuid(), css.validFromRevision());

        assertThat(old.text()).isEqualTo("a{color:red}");
        assertThat(old.revision()).isEqualTo(css.validFromRevision());
    }

    // ------------------------------------------------------------------
    // M18.2.1 — compile on save + edges
    // ------------------------------------------------------------------

    @Test
    void switchingOnAFileWithAnUnknownGlobalIsA422AndLeavesTheFlagOff() {
        Fixture fx = newFixture();
        AssetVersionView css = upload(fx, "site.css", "a{color:$CMS_VALUE(global:site.brandColor)$}");
        int before = revisionCount(fx);

        assertThatThrownBy(() -> mediaService.setProcessCms(css.uuid(), true, css.validFromRevision(), fx.ctx()))
                .isInstanceOfSatisfying(SfException.class, e -> {
                    assertThat(e.getStatus()).isEqualTo(422);
                    assertThat(codes(e)).containsExactly(DiagnosticCodes.OCTL_UNRESOLVABLE_REF);
                });
        assertThat(revisionCount(fx)).isEqualTo(before);
        assertThat(assetService.requireCurrent(fx.project().getId(), css.uuid()).payload().path("processCms").asBoolean(true))
                .isFalse();
    }

    @Test
    void writingPageOnlyInstructionsIntoAProcessedFileIsA422AndStoresNothing() {
        Fixture fx = newFixture();
        AssetVersionView css = processed(fx, upload(fx, "site.css", "a{}"));
        int before = revisionCount(fx);

        for (String source : List.of("$CMS_BODY(main)$", "$CMS_INCLUDE(section_template:x)$")) {
            assertThatThrownBy(() -> mediaService.writeText(css.uuid(), source, css.validFromRevision(), fx.ctx()))
                    .isInstanceOfSatisfying(SfException.class, e -> assertThat(codes(e))
                            .containsExactly(DiagnosticCodes.OCTL_NOT_ALLOWED_IN_TEXT_MEDIA));
        }
        assertThat(revisionCount(fx)).isEqualTo(before);
        assertThat(mediaService.readText(fx.project().getId(), css.uuid(), null).text()).isEqualTo("a{}");
    }

    @Test
    void anUnprocessedFileAcceptsAnyText() {
        Fixture fx = newFixture();
        AssetVersionView css = upload(fx, "site.css", "a{}");

        MediaWriteResult written = mediaService.writeText(css.uuid(), "$CMS_BODY(main)$ $$", css.validFromRevision(), fx.ctx());

        assertThat(written.warnings()).isEmpty();
    }

    @Test
    void warningsComeBackOnASuccessfulSave() {
        Fixture fx = newFixture();
        siteSet(fx);
        AssetVersionView js = upload(fx, "app.js", "const all = $$('a');");

        MediaWriteResult on = mediaService.setProcessCms(js.uuid(), true, js.validFromRevision(), fx.ctx());
        assertThat(on.warnings()).extracting(Diagnostic::code, Diagnostic::line, Diagnostic::column)
                .containsExactly(org.assertj.core.groups.Tuple.tuple(DiagnosticCodes.OCTL_TEXT_MEDIA_DOLLAR_ESCAPE, 1, 13));

        AssetVersionView json = processed(fx, upload(fx, "config.json", "{}"));
        MediaWriteResult unescaped = mediaService.writeText(
                json.uuid(), "{\"title\": \"$CMS_VALUE(global:site.title)$\"}", json.validFromRevision(), fx.ctx());
        assertThat(unescaped.warnings()).extracting(Diagnostic::code)
                .containsExactly(DiagnosticCodes.OCTL_TEXT_MEDIA_UNESCAPED_VALUE);
        MediaWriteResult escaped = mediaService.writeText(json.uuid(),
                "{\"title\": $CMS_VALUE(global:site.title | json)$}", unescaped.media().validFromRevision(), fx.ctx());
        assertThat(escaped.warnings()).isEmpty();
    }

    @Test
    void aProcessedSourceIsListedInTheUsagesOfWhatItReferencesUntilTheFlagGoesOff() {
        Fixture fx = newFixture();
        GlobalSetView site = siteSet(fx);
        AssetVersionView bg = mediaService.upload(fx.project().getId(), null, "bg.png", "image/png", png(), fx.ctx());
        AssetVersionView css = upload(fx, "main.css",
                "a{color:$CMS_VALUE(global:site.brandColor)$;background:url($CMS_REF(media:bg_png)$)}");

        AssetVersionView on = processed(fx, css);

        assertThat(assetService.usages(fx.project().getId(), site.uuid()))
                .extracting(UsageView::fromUuid, UsageView::kind, UsageView::sourcePath)
                .containsExactly(org.assertj.core.groups.Tuple.tuple(css.uuid(), ReferenceKind.OCTL_VALUE, "source"));
        assertThat(assetService.usages(fx.project().getId(), bg.uuid()))
                .extracting(UsageView::fromUuid, UsageView::kind)
                .containsExactly(org.assertj.core.groups.Tuple.tuple(css.uuid(), ReferenceKind.OCTL_REF));

        // A text edit replaces the edge set in the save's revision.
        AssetVersionView edited = mediaService.writeText(
                css.uuid(), "a{background:url($CMS_REF(media:bg_png)$)}", on.validFromRevision(), fx.ctx()).media();
        assertThat(assetService.usages(fx.project().getId(), site.uuid())).isEmpty();
        assertThat(assetService.usagesAt(fx.project().getId(), site.uuid(), on.validFromRevision())).hasSize(1);

        mediaService.setProcessCms(css.uuid(), false, edited.validFromRevision(), fx.ctx());
        assertThat(assetService.usages(fx.project().getId(), bg.uuid())).isEmpty();
    }

    @Test
    void validateTextReturnsDiagnosticsWithoutARevision() {
        Fixture fx = newFixture();
        AssetVersionView css = upload(fx, "site.css", "a{}");
        int before = revisionCount(fx);

        List<Diagnostic> diagnostics = mediaService.validateText(fx.project().getId(), css.uuid(), "a{} $CMS_BODY(x)$ $$");

        assertThat(diagnostics).extracting(Diagnostic::code).containsExactlyInAnyOrder(
                DiagnosticCodes.OCTL_NOT_ALLOWED_IN_TEXT_MEDIA, DiagnosticCodes.OCTL_TEXT_MEDIA_DOLLAR_ESCAPE);
        assertThat(revisionCount(fx)).isEqualTo(before);
    }

    @Test
    void aUidRenameFlagsProcessedSourcesThatStillSpellTheOldUid() {
        Fixture fx = newFixture();
        GlobalSetView site = siteSet(fx);
        AssetVersionView css = processed(fx, upload(fx, "site.css", "a{color:$CMS_VALUE(global:site.brandColor)$}"));
        upload(fx, "plain.css", "/* global:site is not processed */");

        UidChangeResult result = assetService.changeUid(site.uuid(), "brand", fx.ctx());

        assertThat(result.affectedTemplates())
                .extracting(r -> r.assetUuid(), r -> r.assetType(), r -> r.channelKey())
                .containsExactly(org.assertj.core.groups.Tuple.tuple(css.uuid(), AssetType.MEDIA, "source"));
    }

    // ------------------------------------------------------------------
    // Helpers
    // ------------------------------------------------------------------

    private AssetVersionView upload(Fixture fx, String name, String text) {
        return mediaService.upload(fx.project().getId(), null, name, null, text.getBytes(StandardCharsets.UTF_8), fx.ctx());
    }

    private AssetVersionView processed(Fixture fx, AssetVersionView media) {
        return mediaService.setProcessCms(media.uuid(), true, media.validFromRevision(), fx.ctx()).media();
    }

    private GlobalSetView siteSet(Fixture fx) {
        GlobalSetView site = globalSetService.create(new CreateGlobalSetCommand(fx.project().getId(), null, "Site", """
                content {
                  editor text brandColor { label "Brand color" default "#c00" }
                  editor text title { label "Title" default "Acme" }
                }
                """), fx.ctx());
        assertThat(site.uid()).isEqualTo("site");
        return site;
    }

    private int revisionCount(Fixture fx) {
        return revisionRepository.findByProjectIdOrderByRevisionIdDesc(fx.project().getId()).size();
    }

    @SuppressWarnings("unchecked")
    private static List<String> codes(SfException e) {
        Object diagnostics = e.getProblem().getExtensions().get("diagnostics");
        return ((List<Diagnostic>) diagnostics).stream().map(Diagnostic::code).toList();
    }

    private static byte[] png() {
        BufferedImage image = new BufferedImage(8, 8, BufferedImage.TYPE_INT_RGB);
        image.setRGB(0, 0, Color.RED.getRGB());
        try {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            ImageIO.write(image, "png", out);
            return out.toByteArray();
        } catch (IOException e) {
            throw new IllegalStateException(e);
        }
    }

    private Fixture newFixture() {
        int n = SEQ.incrementAndGet();
        AppUser user = userService.create(
                "m18media-user-" + n, "m18media-user-" + n + "@example.com", "M18 Media User " + n, "secret-password");
        Project project = projectService.create(
                new CreateProjectRequest("m18mediap_" + n, "M18 Media Project " + n, null, null), user.getId());
        return new Fixture(project, user);
    }

    private record Fixture(Project project, AppUser user) {
        RevisionContext ctx() {
            return RevisionContext.of(project().getId(), user().getId(), "test");
        }
    }
}
