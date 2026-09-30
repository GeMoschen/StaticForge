package com.acme.staticforge;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.acme.staticforge.asset.AssetService;
import com.acme.staticforge.asset.AssetType;
import com.acme.staticforge.asset.AssetVersionView;
import com.acme.staticforge.asset.media.MediaService;
import com.acme.staticforge.asset.navigation.CreatePageReferenceCommand;
import com.acme.staticforge.asset.navigation.NavTreeNode;
import com.acme.staticforge.asset.navigation.NavigationLookup;
import com.acme.staticforge.asset.navigation.NavigationService;
import com.acme.staticforge.asset.navigation.PageReferenceService;
import com.acme.staticforge.asset.navigation.PageReferenceTargetKind;
import com.acme.staticforge.asset.page.CreatePageCommand;
import com.acme.staticforge.asset.page.PageService;
import com.acme.staticforge.asset.template.CreateTemplateCommand;
import com.acme.staticforge.asset.template.TemplateService;
import com.acme.staticforge.asset.template.TemplateView;
import com.acme.staticforge.asset.template.UpdateTemplateCommand;
import com.acme.staticforge.common.L10nValues;
import com.acme.staticforge.common.SfException;
import com.acme.staticforge.project.CreateProjectRequest;
import com.acme.staticforge.project.LocaleConfig;
import com.acme.staticforge.project.Project;
import com.acme.staticforge.project.ProjectLocale;
import com.acme.staticforge.project.ProjectService;
import com.acme.staticforge.revision.ChangeType;
import com.acme.staticforge.revision.Revision;
import com.acme.staticforge.revision.RevisionContext;
import com.acme.staticforge.revision.RevisionRepository;
import com.acme.staticforge.template.cdl.CdlSources;
import com.acme.staticforge.user.AppUser;
import com.acme.staticforge.user.UserService;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;

/**
 * The {@code localizable} content migration (M24.2.2): turning language dependence on wraps every
 * stored value in one compound revision, turning it off needs a confirmation and never loses data
 * silently, and media metadata and navigation labels follow the same per-language rule.
 */
@SpringBootTest
@ActiveProfiles("test")
class LocalizationMigrationIntegrationTest {

    private static final AtomicInteger SEQ = new AtomicInteger();

    private static final String LOCALIZED_CDL =
            """
            content {
              editor text headline { label "Headline" localizable }
              editor text sku { label "SKU" }
            }
            """;

    private static final String BODY_CDL =
            """
            content { }
            bodies { body main { label "Main" allow ["*"] } }
            """;

    private static final String PLAIN_CDL =
            """
            content {
              editor text headline { label "Headline" }
              editor text sku { label "SKU" }
            }
            """;

    @Autowired UserService userService;
    @Autowired ProjectService projectService;
    @Autowired PageService pageService;
    @Autowired AssetService assetService;
    @Autowired TemplateService templateService;
    @Autowired MediaService mediaService;
    @Autowired NavigationService navigationService;
    @Autowired NavigationLookup navigationLookup;
    @Autowired PageReferenceService pageReferenceService;
    @Autowired RevisionRepository revisionRepository;
    @Autowired com.acme.staticforge.asset.AssetRepository assetRepository;
    @Autowired com.acme.staticforge.asset.AssetVersionRepository assetVersionRepository;

    private record Fixture(Project project, AppUser user, RevisionContext ctx) {}

    private Fixture newFixture(String prefix) {
        int n = SEQ.incrementAndGet();
        AppUser user = userService.create(prefix + n, prefix + n + "@example.com", "L10n " + n, "secret-password");
        Project project = projectService.create(
                new CreateProjectRequest(prefix + n, prefix + n, null, "fixture"), user.getId());
        return new Fixture(project, user, RevisionContext.of(project.getId(), user.getId(), "l10n test"));
    }

    private void enableLocales(Fixture fx, boolean confirmDiscard) {
        projectService.updateLocales(
                fx.project().getKey(),
                LocaleConfig.of(
                        List.of(new ProjectLocale("de", "Deutsch"), new ProjectLocale("en", "English")),
                        "de",
                        Map.of(),
                        false),
                confirmDiscard,
                fx.ctx());
    }

    private JsonNode payloadOf(Fixture fx, UUID uuid) {
        return assetService.requireCurrent(fx.project().getId(), uuid).payload();
    }

    private long revisionCount(Fixture fx) {
        return revisionRepository.findByProjectIdOrderByRevisionIdDesc(fx.project().getId()).size();
    }

    private TemplateView template(Fixture fx, String cdl) {
        return templateService.create(
                new CreateTemplateCommand(
                        fx.project().getId(),
                        AssetType.PAGE_TEMPLATE,
                        "Article" + SEQ.incrementAndGet(),
                        CdlSources.split(cdl),
                        Map.of("html", "<h1>$CMS_VALUE(headline)$</h1>"),
                        null,
                        false,
                        null),
                fx.ctx());
    }

    private AssetVersionView pageWithHeadline(Fixture fx, TemplateView template, String name, String headline) {
        AssetVersionView page = pageService.create(new CreatePageCommand(name, null, template.uuid()), fx.ctx());
        ObjectNode payload = (ObjectNode) page.payload().deepCopy();
        payload.putObject("content").put("headline", headline).put("sku", "A-1");
        return pageService.update(page.uuid(), payload, page.validFromRevision(), fx.ctx());
    }

    @Test
    @DisplayName("turning localizable on wraps every page's value in one revision")
    void toggleOnWrapsAllPagesInOneRevision() {
        Fixture fx = newFixture("l10n-on");
        enableLocales(fx, false);
        TemplateView template = template(fx, PLAIN_CDL);
        List<UUID> pages = new ArrayList<>();
        for (String name : List.of("One", "Two", "Three")) {
            pages.add(pageWithHeadline(fx, template, name, "Schlagzeile " + name).uuid());
        }
        long before = revisionCount(fx);

        templateService.update(
                template.uuid(),
                new UpdateTemplateCommand(
                        "Article", CdlSources.split(LOCALIZED_CDL), Map.of("html", "<h1>$CMS_VALUE(headline)$</h1>"),
                        null, false, null, false, null),
                assetService.requireCurrent(fx.project().getId(), template.uuid()).validFromRevision(),
                fx.ctx());

        // One revision for the CDL change and all three pages it rewrote.
        assertThat(revisionCount(fx)).isEqualTo(before + 1);
        Revision revision = revisionRepository.findByProjectIdOrderByRevisionIdDesc(fx.project().getId()).get(0);
        assertThat(revision.getChangeType()).isEqualTo(ChangeType.UPDATE);

        for (UUID page : pages) {
            JsonNode headline = payloadOf(fx, page).path("content").path("headline");
            assertThat(L10nValues.isL10n(headline)).as("page %s", page).isTrue();
            assertThat(L10nValues.get(headline, "de").asText()).startsWith("Schlagzeile");
            // A non-localizable editor keeps its bare value.
            assertThat(payloadOf(fx, page).path("content").path("sku").asText()).isEqualTo("A-1");
        }
    }

    @Test
    @DisplayName("the summary of that revision lists the template and every rewritten page")
    void revisionSummaryListsTemplateAndPages() {
        Fixture fx = newFixture("l10n-sum");
        enableLocales(fx, false);
        TemplateView template = template(fx, PLAIN_CDL);
        List<UUID> pages = List.of(
                pageWithHeadline(fx, template, "One", "Eins").uuid(),
                pageWithHeadline(fx, template, "Two", "Zwei").uuid(),
                pageWithHeadline(fx, template, "Three", "Drei").uuid());

        templateService.update(
                template.uuid(),
                new UpdateTemplateCommand(
                        "Article", CdlSources.split(LOCALIZED_CDL), Map.of("html", "<h1>$CMS_VALUE(headline)$</h1>"),
                        null, false, null, false, null),
                assetService.requireCurrent(fx.project().getId(), template.uuid()).validFromRevision(),
                fx.ctx());

        Revision revision = revisionRepository.findByProjectIdOrderByRevisionIdDesc(fx.project().getId()).get(0);
        String summary = revision.getSummary() == null ? "" : revision.getSummary().toString();
        assertThat(summary).contains(template.uuid().toString());
        pages.forEach(page -> assertThat(summary).contains(page.toString()));
    }

    @Test
    @DisplayName("turning localizable off with a translation present is refused until confirmed")
    void toggleOffNeedsConfirmation() {
        Fixture fx = newFixture("l10n-off");
        enableLocales(fx, false);
        TemplateView template = template(fx, LOCALIZED_CDL);
        AssetVersionView page = pageService.create(new CreatePageCommand("One", null, template.uuid()), fx.ctx());
        ObjectNode payload = (ObjectNode) page.payload().deepCopy();
        payload.putObject("content")
                .set("headline", L10nValues.with(L10nValues.wrap(null, "de"), "de",
                        com.fasterxml.jackson.databind.node.JsonNodeFactory.instance.textNode("Die Parka")));
        page = pageService.update(page.uuid(), payload, page.validFromRevision(), fx.ctx());
        ObjectNode withEnglish = (ObjectNode) page.payload().deepCopy();
        ((ObjectNode) withEnglish.get("content")).set("headline", L10nValues.with(
                withEnglish.path("content").path("headline"), "en",
                com.fasterxml.jackson.databind.node.JsonNodeFactory.instance.textNode("The parka")));
        pageService.update(page.uuid(), withEnglish, page.validFromRevision(), fx.ctx());

        long before = revisionCount(fx);
        long expectedRevision =
                assetService.requireCurrent(fx.project().getId(), template.uuid()).validFromRevision();
        UpdateTemplateCommand plain = new UpdateTemplateCommand(
                "Article", CdlSources.split(PLAIN_CDL), Map.of("html", "<h1>$CMS_VALUE(headline)$</h1>"), null, false, null, false, null);

        assertThatThrownBy(() -> templateService.update(template.uuid(), plain, expectedRevision, fx.ctx()))
                .isInstanceOf(SfException.class)
                .satisfies(e -> {
                    var problem = ((SfException) e).getProblem();
                    assertThat(problem.getStatus()).isEqualTo(409);
                    assertThat(problem.getExtensions()).containsEntry("discardedLocaleValues", 1);
                });

        // Nothing was written: the CDL, the page value and the revision counter are untouched.
        assertThat(revisionCount(fx)).isEqualTo(before);
        assertThat(L10nValues.isL10n(payloadOf(fx, page.uuid()).path("content").path("headline"))).isTrue();

        // The confirmed save unwraps to the default language in one revision.
        templateService.update(template.uuid(), plain, expectedRevision, true, fx.ctx());

        assertThat(revisionCount(fx)).isEqualTo(before + 1);
        assertThat(payloadOf(fx, page.uuid()).path("content").path("headline").asText()).isEqualTo("Die Parka");
    }

    @Test
    @DisplayName("enabling project locales wraps existing values in the settings change's own revision")
    void enablingProjectLocalesWrapsValues() {
        Fixture fx = newFixture("l10n-proj");
        TemplateView template = template(fx, LOCALIZED_CDL);
        UUID page = pageWithHeadline(fx, template, "One", "Schlagzeile").uuid();

        // Without locales, `localizable` is inactive and the value stays bare.
        assertThat(payloadOf(fx, page).path("content").path("headline").asText()).isEqualTo("Schlagzeile");

        long before = revisionCount(fx);
        enableLocales(fx, false);

        assertThat(revisionCount(fx)).isEqualTo(before + 1);
        JsonNode headline = payloadOf(fx, page).path("content").path("headline");
        assertThat(L10nValues.get(headline, "de").asText()).isEqualTo("Schlagzeile");
    }

    @Test
    @DisplayName("disabling project locales reports the discard first, then unwraps once confirmed")
    void disablingProjectLocalesNeedsConfirmation() {
        Fixture fx = newFixture("l10n-dis");
        enableLocales(fx, false);
        TemplateView template = template(fx, LOCALIZED_CDL);
        AssetVersionView page = pageService.create(new CreatePageCommand("One", null, template.uuid()), fx.ctx());
        ObjectNode payload = (ObjectNode) page.payload().deepCopy();
        ObjectNode content = payload.putObject("content");
        ObjectNode wrapper = L10nValues.wrap(
                com.fasterxml.jackson.databind.node.JsonNodeFactory.instance.textNode("Die Parka"), "de");
        content.set("headline", L10nValues.with(wrapper, "en",
                com.fasterxml.jackson.databind.node.JsonNodeFactory.instance.textNode("The parka")));
        pageService.update(page.uuid(), payload, page.validFromRevision(), fx.ctx());

        long before = revisionCount(fx);
        ProjectService.LocaleUpdateResult refused =
                projectService.updateLocales(fx.project().getKey(), LocaleConfig.EMPTY, false, fx.ctx());

        assertThat(refused.confirmationRequired()).isTrue();
        assertThat(refused.discardedLocaleValues()).isEqualTo(1);
        assertThat(refused.affectedAssets()).containsExactly(page.uuid());
        assertThat(revisionCount(fx)).isEqualTo(before);
        assertThat(projectService.locales(fx.project().getKey()).isLocalized()).isTrue();

        ProjectService.LocaleUpdateResult applied =
                projectService.updateLocales(fx.project().getKey(), LocaleConfig.EMPTY, true, fx.ctx());

        assertThat(applied.confirmationRequired()).isFalse();
        assertThat(projectService.locales(fx.project().getKey()).isLocalized()).isFalse();
        assertThat(payloadOf(fx, page.uuid()).path("content").path("headline").asText()).isEqualTo("Die Parka");
    }

    @Test
    @DisplayName("removing a locale keeps its values and reports how many were retained")
    void removingALocaleKeepsValues() {
        Fixture fx = newFixture("l10n-keep");
        enableLocales(fx, false);
        TemplateView template = template(fx, LOCALIZED_CDL);
        AssetVersionView page = pageService.create(new CreatePageCommand("One", null, template.uuid()), fx.ctx());
        ObjectNode payload = (ObjectNode) page.payload().deepCopy();
        ObjectNode wrapper = L10nValues.wrap(
                com.fasterxml.jackson.databind.node.JsonNodeFactory.instance.textNode("Die Parka"), "de");
        payload.putObject("content").set("headline", L10nValues.with(wrapper, "en",
                com.fasterxml.jackson.databind.node.JsonNodeFactory.instance.textNode("The parka")));
        pageService.update(page.uuid(), payload, page.validFromRevision(), fx.ctx());

        ProjectService.LocaleUpdateResult result = projectService.updateLocales(
                fx.project().getKey(),
                LocaleConfig.of(List.of(new ProjectLocale("de", "Deutsch")), "de", Map.of(), false),
                false,
                fx.ctx());

        assertThat(result.removedLocales()).containsExactly("en");
        assertThat(result.retainedValueCount()).isEqualTo(1);
        // The English value survives, so re-adding the locale restores it.
        assertThat(L10nValues.get(payloadOf(fx, page.uuid()).path("content").path("headline"), "en").asText())
                .isEqualTo("The parka");
    }

    @Test
    @DisplayName("a section instance's values inside a body are migrated too")
    void sectionInstanceValuesMigrate() {
        Fixture fx = newFixture("l10n-sec");
        enableLocales(fx, false);
        TemplateView section = templateService.create(
                new CreateTemplateCommand(
                        fx.project().getId(), AssetType.SECTION_TEMPLATE, "Teaser",
                        CdlSources.split(PLAIN_CDL), Map.of("html", "<p>$CMS_VALUE(headline)$</p>"), null, false, null),
                fx.ctx());
        TemplateView pageTemplate = templateService.create(
                new CreateTemplateCommand(
                        fx.project().getId(), AssetType.PAGE_TEMPLATE, "WithBody",
                        CdlSources.split(BODY_CDL), Map.of("html", "$CMS_BODY(main)$"), null, false, null),
                fx.ctx());
        AssetVersionView page = pageService.create(new CreatePageCommand("Host", null, pageTemplate.uuid()), fx.ctx());
        ObjectNode payload = (ObjectNode) page.payload().deepCopy();
        ObjectNode instance = payload.putObject("bodies").putArray("main").addObject();
        instance.put("instanceId", UUID.randomUUID().toString());
        instance.put("templateRef", section.uuid().toString());
        instance.putObject("content").put("headline", "Teaser-Schlagzeile");
        pageService.update(page.uuid(), payload, page.validFromRevision(), fx.ctx());

        templateService.update(
                section.uuid(),
                new UpdateTemplateCommand(
                        "Teaser", CdlSources.split(LOCALIZED_CDL), Map.of("html", "<p>$CMS_VALUE(headline)$</p>"), null, false, null),
                assetService.requireCurrent(fx.project().getId(), section.uuid()).validFromRevision(),
                fx.ctx());

        JsonNode migrated = payloadOf(fx, page.uuid()).path("bodies").path("main").get(0).path("content").path("headline");
        assertThat(L10nValues.get(migrated, "de").asText()).isEqualTo("Teaser-Schlagzeile");
    }

    @Test
    @DisplayName("media alt text is written and read back per language")
    void mediaAltTextPerLocale() {
        Fixture fx = newFixture("l10n-media");
        enableLocales(fx, false);
        AssetVersionView uploaded = mediaService.upload(
                fx.project().getId(),
                assetService.ensureMediaRootFolder(fx.project().getId(), fx.ctx()).uuid(),
                "photo.txt",
                "text/plain",
                "hello".getBytes(StandardCharsets.UTF_8),
                fx.ctx());
        UUID media = uploaded.uuid();

        AssetVersionView afterGerman = mediaService.updateMetadata(
                media, "Ein Foto", "Bildunterschrift", "Jane Doe", null, "de",
                uploaded.validFromRevision(), fx.ctx());
        AssetVersionView afterEnglish = mediaService.updateMetadata(
                media, "A photo", "Caption", "Jane Doe", null, "en", afterGerman.validFromRevision(), fx.ctx());

        JsonNode altText = afterEnglish.payload().get("altText");
        assertThat(L10nValues.get(altText, "de").asText()).isEqualTo("Ein Foto");
        assertThat(L10nValues.get(altText, "en").asText()).isEqualTo("A photo");
        assertThat(afterEnglish.payload().path("copyright").asText()).isEqualTo("Jane Doe");
    }

    @Test
    @DisplayName("navigation labels resolve per language, falling back to the default")
    void navigationLabelsPerLocale() {
        Fixture fx = newFixture("l10n-nav");
        enableLocales(fx, false);
        TemplateView template = template(fx, PLAIN_CDL);
        AssetVersionView page = pageService.create(new CreatePageCommand("Target", null, template.uuid()), fx.ctx());
        UUID navRoot = navigationRoot(fx);

        AssetVersionView reference = pageReferenceService.create(
                new CreatePageReferenceCommand(
                        "Ref", navRoot, PageReferenceTargetKind.PAGE, page.uuid(), null),
                fx.ctx());
        AssetVersionView afterGerman = pageReferenceService.update(
                reference.uuid(), PageReferenceTargetKind.PAGE, page.uuid(), "Startseite", "de",
                reference.validFromRevision(), fx.ctx());
        pageReferenceService.update(
                reference.uuid(), PageReferenceTargetKind.PAGE, page.uuid(), "Home", "en",
                afterGerman.validFromRevision(), fx.ctx());

        assertThat(labelOf(fx, navRoot, reference.uuid(), List.of("de"))).isEqualTo("Startseite");
        assertThat(labelOf(fx, navRoot, reference.uuid(), List.of("en"))).isEqualTo("Home");
        // An untranslated language falls back through the chain.
        assertThat(labelOf(fx, navRoot, reference.uuid(), List.of("fr", "de"))).isEqualTo("Startseite");
    }

    @Test
    @DisplayName("media alt text stored plain wraps as the default language: editing another language first keeps it")
    void plainMediaAltTextBelongsToTheDefaultLanguage() {
        Fixture fx = newFixture("l10n-plainmedia");
        enableLocales(fx, false);
        UUID folder = assetService.ensureMediaRootFolder(fx.project().getId(), fx.ctx()).uuid();
        // An upload stores its alt text and caption as plain strings, whatever the project's languages.
        AssetVersionView uploaded = mediaService.upload(fx.project().getId(), folder, "plain.txt", "text/plain",
                "Ein Foto", "Unterschrift", "hello".getBytes(StandardCharsets.UTF_8), fx.ctx());
        assertThat(uploaded.payload().path("altText").isTextual()).isTrue();

        AssetVersionView afterEnglish = mediaService.updateMetadata(
                uploaded.uuid(), "A photo", "Caption", null, null, "en", uploaded.validFromRevision(), fx.ctx());

        assertThat(L10nValues.get(afterEnglish.payload().get("altText"), "de").asText()).isEqualTo("Ein Foto");
        assertThat(L10nValues.get(afterEnglish.payload().get("altText"), "en").asText()).isEqualTo("A photo");
        assertThat(L10nValues.get(afterEnglish.payload().get("caption"), "de").asText()).isEqualTo("Unterschrift");
        assertThat(L10nValues.get(afterEnglish.payload().get("caption"), "en").asText()).isEqualTo("Caption");

        // Editing the default language itself replaces the plain value, as before.
        AssetVersionView plainAgain = mediaService.upload(fx.project().getId(), folder, "plain2.txt", "text/plain",
                "Ein Foto", null, "hello".getBytes(StandardCharsets.UTF_8), fx.ctx());
        AssetVersionView afterGerman = mediaService.updateMetadata(
                plainAgain.uuid(), "Ein Bild", null, null, null, "de", plainAgain.validFromRevision(), fx.ctx());
        assertThat(L10nValues.get(afterGerman.payload().get("altText"), "de").asText()).isEqualTo("Ein Bild");
        assertThat(L10nValues.get(afterGerman.payload().get("altText"), "en")).isNull();
    }

    @Test
    @DisplayName("a project without languages keeps media alt text and navigation labels plain")
    void singleLanguageValuesStayPlain() {
        Fixture fx = newFixture("l10n-single");
        UUID folder = assetService.ensureMediaRootFolder(fx.project().getId(), fx.ctx()).uuid();
        AssetVersionView uploaded = mediaService.upload(fx.project().getId(), folder, "one.txt", "text/plain",
                "Alt", null, "hello".getBytes(StandardCharsets.UTF_8), fx.ctx());
        AssetVersionView edited = mediaService.updateMetadata(
                uploaded.uuid(), "New alt", null, null, null, "en", uploaded.validFromRevision(), fx.ctx());
        assertThat(edited.payload().path("altText").asText()).isEqualTo("New alt");

        TemplateView template = template(fx, PLAIN_CDL);
        AssetVersionView page = pageService.create(new CreatePageCommand("Target", null, template.uuid()), fx.ctx());
        AssetVersionView reference = pageReferenceService.create(
                new CreatePageReferenceCommand(
                        "Ref", navigationRoot(fx), PageReferenceTargetKind.PAGE, page.uuid(), "Home"),
                fx.ctx());
        AssetVersionView relabelled = pageReferenceService.update(
                reference.uuid(), PageReferenceTargetKind.PAGE, page.uuid(), "Start", "en",
                reference.validFromRevision(), fx.ctx());
        assertThat(relabelled.payload().path("label").asText()).isEqualTo("Start");
    }

    @Test
    @DisplayName("a navigation label stored plain wraps as the default language: editing another language first keeps it")
    void plainNavigationLabelBelongsToTheDefaultLanguage() {
        Fixture fx = newFixture("l10n-plainnav");
        enableLocales(fx, false);
        TemplateView template = template(fx, PLAIN_CDL);
        AssetVersionView page = pageService.create(new CreatePageCommand("Target", null, template.uuid()), fx.ctx());
        UUID navRoot = navigationRoot(fx);
        AssetVersionView reference = pageReferenceService.create(
                new CreatePageReferenceCommand("Ref", navRoot, PageReferenceTargetKind.PAGE, page.uuid(), "Startseite"),
                fx.ctx());
        assertThat(reference.payload().path("label").isTextual()).isTrue();

        AssetVersionView afterEnglish = pageReferenceService.update(
                reference.uuid(), PageReferenceTargetKind.PAGE, page.uuid(), "Home", "en",
                reference.validFromRevision(), fx.ctx());

        assertThat(L10nValues.get(afterEnglish.payload().get("label"), "de").asText()).isEqualTo("Startseite");
        assertThat(L10nValues.get(afterEnglish.payload().get("label"), "en").asText()).isEqualTo("Home");
        assertThat(labelOf(fx, navRoot, reference.uuid(), List.of("de"))).isEqualTo("Startseite");
    }

    private UUID navigationRoot(Fixture fx) {
        return assetService.ensureNavigationRootFolder(fx.project().getId(), fx.ctx()).uuid();
    }

    private String labelOf(Fixture fx, UUID navRoot, UUID referenceUuid, List<String> chain) {
        NavTreeNode tree = navigationService.tree(
                fx.project().getId(), navRoot, -1, navigationLookup, new ArrayList<>(), chain);
        return findNode(tree, referenceUuid).label();
    }

    private static NavTreeNode findNode(NavTreeNode node, UUID uuid) {
        if (node.assetUuid().equals(uuid)) {
            return node;
        }
        for (NavTreeNode child : node.children()) {
            NavTreeNode found = findNode(child, uuid);
            if (found != null) {
                return found;
            }
        }
        return null;
    }
}
