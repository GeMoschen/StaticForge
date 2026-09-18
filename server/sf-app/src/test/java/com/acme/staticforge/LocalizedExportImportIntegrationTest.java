package com.acme.staticforge;

import static org.assertj.core.api.Assertions.assertThat;

import com.acme.staticforge.asset.AssetService;
import com.acme.staticforge.asset.AssetType;
import com.acme.staticforge.asset.AssetVersionView;
import com.acme.staticforge.asset.folder.FolderScope;
import com.acme.staticforge.asset.page.CreatePageCommand;
import com.acme.staticforge.asset.page.PageService;
import com.acme.staticforge.asset.template.CreateTemplateCommand;
import com.acme.staticforge.asset.template.TemplateService;
import com.acme.staticforge.asset.template.TemplateView;
import com.acme.staticforge.common.L10nValues;
import com.acme.staticforge.exportimport.ConflictReport;
import com.acme.staticforge.exportimport.ConflictType;
import com.acme.staticforge.exportimport.ExportSelection;
import com.acme.staticforge.exportimport.ImportOptions;
import com.acme.staticforge.exportimport.ProjectExportImportService;
import com.acme.staticforge.project.CreateProjectRequest;
import com.acme.staticforge.project.LocaleConfig;
import com.acme.staticforge.project.Project;
import com.acme.staticforge.project.ProjectLocale;
import com.acme.staticforge.project.ProjectService;
import com.acme.staticforge.revision.RevisionContext;
import com.acme.staticforge.user.AppUser;
import com.acme.staticforge.user.UserService;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;

/**
 * Archives of a localized project (M24.5.1): the language configuration travels with the settings,
 * every translation round-trips, and a language mismatch between archive and target is reported
 * rather than silently resolved.
 */
@SpringBootTest
@ActiveProfiles("test")
class LocalizedExportImportIntegrationTest {

    private static final AtomicInteger SEQ = new AtomicInteger();

    private static final String CDL =
            """
            content {
              editor text headline { label "Headline" localizable }
            }
            """;

    @Autowired UserService userService;
    @Autowired ProjectService projectService;
    @Autowired AssetService assetService;
    @Autowired PageService pageService;
    @Autowired TemplateService templateService;
    @Autowired ProjectExportImportService exportImportService;

    private record Fixture(Project project, AppUser user, RevisionContext ctx) {}

    private Fixture newFixture(String prefix) {
        int n = SEQ.incrementAndGet();
        AppUser user = userService.create(prefix + n, prefix + n + "@example.com", "L10n IO", "secret-password");
        Project project = projectService.create(
                new CreateProjectRequest(prefix + n, prefix + n, null, "l10n export"), user.getId());
        return new Fixture(project, user, RevisionContext.of(project.getId(), user.getId(), "l10n export"));
    }

    private void enableLocales(Fixture fx) {
        projectService.updateLocales(
                fx.project().getKey(),
                LocaleConfig.of(
                        List.of(new ProjectLocale("de", "Deutsch"), new ProjectLocale("en", "English")),
                        "de",
                        Map.of("en", List.of("de")),
                        false),
                true,
                fx.ctx());
    }

    private UUID localizedPage(Fixture fx) {
        TemplateView template = templateService.create(
                new CreateTemplateCommand(
                        fx.project().getId(),
                        AssetType.PAGE_TEMPLATE,
                        "Article",
                        CDL,
                        Map.of("html", "<h1>$CMS_VALUE(headline)$</h1>"),
                        null,
                        false,
                        Map.of()),
                fx.ctx());
        AssetVersionView page = pageService.create(new CreatePageCommand("about", null, template.uuid()), fx.ctx());
        ObjectNode payload = (ObjectNode) page.payload().deepCopy();
        ObjectNode wrapper = L10nValues.wrap(JsonNodeFactory.instance.textNode("Ueber uns"), "de");
        payload.putObject("content")
                .set("headline", L10nValues.with(wrapper, "en", JsonNodeFactory.instance.textNode("About us")));
        pageService.update(page.uuid(), payload, page.validFromRevision(), fx.ctx());
        return page.uuid();
    }

    private byte[] exportAll(Fixture fx) {
        return exportImportService.exportSelection(
                fx.project().getId(),
                new ExportSelection(Set.of(), true, true, Set.of(FolderScope.PAGES, FolderScope.TEMPLATES)));
    }

    @Test
    @DisplayName("the language configuration and every translation round-trip into a fresh project")
    void roundTripsLanguagesAndTranslations() {
        Fixture source = newFixture("l10nexp");
        enableLocales(source);
        UUID page = localizedPage(source);
        byte[] archive = exportAll(source);

        Fixture target = newFixture("l10nimp");
        exportImportService.importProject(target.project().getId(), archive, target.ctx(), ImportOptions.DEFAULT);

        LocaleConfig imported = projectService.locales(target.project().getKey());
        assertThat(imported.codes()).containsExactly("de", "en");
        assertThat(imported.defaultLocale()).isEqualTo("de");
        assertThat(imported.effectiveChain("en")).containsExactly("en", "de");

        JsonNode headline = assetService.requireCurrent(target.project().getId(), page)
                .payload()
                .path("content")
                .path("headline");
        assertThat(L10nValues.get(headline, "de").asText()).isEqualTo("Ueber uns");
        assertThat(L10nValues.get(headline, "en").asText()).isEqualTo("About us");
    }

    @Test
    @DisplayName("importing a localized archive into a project without languages is reported, not silently applied")
    void shapeMismatchIsReported() {
        Fixture source = newFixture("l10nshape");
        enableLocales(source);
        localizedPage(source);
        byte[] archive = exportAll(source);

        Fixture target = newFixture("plainimp");
        ConflictReport report = exportImportService.analyzeImport(target.project().getId(), archive, ImportOptions.DEFAULT);

        // The target has no languages yet, so the archive's configuration is what it will adopt —
        // the shape warning is about the values arriving before that happens.
        assertThat(report.conflicts())
                .extracting(conflict -> conflict.type())
                .contains(ConflictType.LOCALIZATION_SHAPE_MISMATCH);
        assertThat(report.conflicts().stream().noneMatch(c -> c.severity().name().equals("BLOCKING"))).isTrue();
    }

    @Test
    @DisplayName("a different language set between archive and target is a warning naming both sides")
    void localeConfigMismatchIsReported() {
        Fixture source = newFixture("l10nmis");
        enableLocales(source);
        localizedPage(source);
        byte[] archive = exportAll(source);

        Fixture target = newFixture("l10nfr");
        projectService.updateLocales(
                target.project().getKey(),
                LocaleConfig.of(List.of(new ProjectLocale("fr", "Français")), "fr", Map.of(), false),
                true,
                target.ctx());

        ConflictReport report = exportImportService.analyzeImport(target.project().getId(), archive, ImportOptions.DEFAULT);

        assertThat(report.conflicts())
                .anySatisfy(conflict -> {
                    assertThat(conflict.type()).isEqualTo(ConflictType.LOCALE_CONFIG_MISMATCH);
                    assertThat(conflict.detail()).contains("de").contains("en").contains("fr");
                });
    }

    @Test
    @DisplayName("a target that already has languages keeps its own configuration")
    void targetKeepsItsOwnLanguages() {
        Fixture source = newFixture("l10nkeepsrc");
        enableLocales(source);
        localizedPage(source);
        byte[] archive = exportAll(source);

        Fixture target = newFixture("l10nkeep");
        projectService.updateLocales(
                target.project().getKey(),
                LocaleConfig.of(List.of(new ProjectLocale("fr", "Français")), "fr", Map.of(), false),
                true,
                target.ctx());

        exportImportService.importProject(target.project().getId(), archive, target.ctx(), ImportOptions.DEFAULT);

        assertThat(projectService.locales(target.project().getKey()).codes()).containsExactly("fr");
    }

    @Test
    @DisplayName("an archive of a project without languages still imports")
    void plainArchiveStillImports() {
        Fixture source = newFixture("plainexp");
        TemplateView template = templateService.create(
                new CreateTemplateCommand(
                        source.project().getId(),
                        AssetType.PAGE_TEMPLATE,
                        "Plain",
                        "content { editor text headline { label \"Headline\" } }",
                        Map.of("html", "<h1>$CMS_VALUE(headline)$</h1>"),
                        null,
                        false,
                        Map.of()),
                source.ctx());
        AssetVersionView page = pageService.create(new CreatePageCommand("about", null, template.uuid()), source.ctx());
        ObjectNode payload = (ObjectNode) page.payload().deepCopy();
        payload.putObject("content").put("headline", "About us");
        pageService.update(page.uuid(), payload, page.validFromRevision(), source.ctx());

        Fixture target = newFixture("plaintarget");
        exportImportService.importProject(
                target.project().getId(), exportAll(source), target.ctx(), ImportOptions.DEFAULT);

        assertThat(projectService.locales(target.project().getKey()).isLocalized()).isFalse();
        assertThat(assetService.requireCurrent(target.project().getId(), page.uuid())
                        .payload()
                        .path("content")
                        .path("headline")
                        .asText())
                .isEqualTo("About us");
    }
}
