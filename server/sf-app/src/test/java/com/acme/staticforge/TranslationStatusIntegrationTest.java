package com.acme.staticforge;

import static org.assertj.core.api.Assertions.assertThat;

import com.acme.staticforge.asset.AssetService;
import com.acme.staticforge.asset.AssetType;
import com.acme.staticforge.asset.AssetVersionView;
import com.acme.staticforge.asset.localization.TranslationStatus;
import com.acme.staticforge.asset.localization.TranslationStatusService;
import com.acme.staticforge.asset.page.CreatePageCommand;
import com.acme.staticforge.asset.page.PageService;
import com.acme.staticforge.asset.template.CreateTemplateCommand;
import com.acme.staticforge.asset.template.TemplateService;
import com.acme.staticforge.asset.template.TemplateView;
import com.acme.staticforge.common.L10nValues;
import com.acme.staticforge.project.CreateProjectRequest;
import com.acme.staticforge.project.LocaleConfig;
import com.acme.staticforge.project.Project;
import com.acme.staticforge.project.ProjectLocale;
import com.acme.staticforge.project.ProjectService;
import com.acme.staticforge.revision.RevisionContext;
import com.acme.staticforge.template.cdl.CdlSources;
import com.acme.staticforge.user.AppUser;
import com.acme.staticforge.user.UserService;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;

/** Which assets are still missing translations (M24.4.2). */
@SpringBootTest
@ActiveProfiles("test")
class TranslationStatusIntegrationTest {

    private static final AtomicInteger SEQ = new AtomicInteger();

    private static final String CDL =
            """
            content {
              editor text headline { label "Headline" localizable }
              editor text teaser   { label "Teaser" localizable }
              editor text subtitle { label "Subtitle" localizable }
              editor text lead     { label "Lead" localizable }
              editor text sku      { label "SKU" }
            }
            """;

    @Autowired UserService userService;
    @Autowired ProjectService projectService;
    @Autowired AssetService assetService;
    @Autowired PageService pageService;
    @Autowired TemplateService templateService;
    @Autowired TranslationStatusService translationStatus;

    private record Fixture(Project project, AppUser user, RevisionContext ctx) {}

    private Fixture newFixture(String prefix) {
        int n = SEQ.incrementAndGet();
        AppUser user = userService.create(prefix + n, prefix + n + "@example.com", "Status", "secret-password");
        Project project = projectService.create(
                new CreateProjectRequest(prefix + n, prefix + n, null, "translation status"), user.getId());
        return new Fixture(project, user, RevisionContext.of(project.getId(), user.getId(), "translation status"));
    }

    private void enableLocales(Fixture fx) {
        projectService.updateLocales(
                fx.project().getKey(),
                LocaleConfig.of(
                        List.of(new ProjectLocale("de", "Deutsch"), new ProjectLocale("en", "English")),
                        "de",
                        Map.of(),
                        false),
                true,
                fx.ctx());
    }

    private TemplateView template(Fixture fx) {
        return templateService.create(
                new CreateTemplateCommand(
                        fx.project().getId(),
                        AssetType.PAGE_TEMPLATE,
                        "Article" + SEQ.incrementAndGet(),
                        CdlSources.split(CDL),
                        Map.of("html", "<h1>$CMS_VALUE(headline)$</h1>"),
                        null,
                        false,
                        Map.of()),
                fx.ctx());
    }

    /** A page whose four language-dependent fields are all filled in German, and {@code translated} of them in English. */
    private UUID page(Fixture fx, TemplateView template, String name, int translated) {
        AssetVersionView page = pageService.create(new CreatePageCommand(name, null, template.uuid()), fx.ctx());
        ObjectNode payload = (ObjectNode) page.payload().deepCopy();
        ObjectNode content = payload.putObject("content");
        List<String> fields = List.of("headline", "teaser", "subtitle", "lead");
        for (int i = 0; i < fields.size(); i++) {
            ObjectNode wrapper = L10nValues.wrap(JsonNodeFactory.instance.textNode("DE " + fields.get(i)), "de");
            if (i < translated) {
                wrapper = L10nValues.with(wrapper, "en", JsonNodeFactory.instance.textNode("EN " + fields.get(i)));
            }
            content.set(fields.get(i), wrapper);
        }
        content.put("sku", "A-1");
        pageService.update(page.uuid(), payload, page.validFromRevision(), fx.ctx());
        return page.uuid();
    }

    @Test
    @DisplayName("counts the fields a language still owes, the default language owing none")
    void countsMissingFields() {
        Fixture fx = newFixture("tstat");
        enableLocales(fx);
        UUID page = page(fx, template(fx), "About", 3);

        TranslationStatus status = translationStatus.of(fx.project().getId(), page);

        assertThat(status.locales())
                .containsExactly(
                        new TranslationStatus.LocaleStatus("de", 0, 4),
                        new TranslationStatus.LocaleStatus("en", 1, 4));
        assertThat(status.incomplete()).isTrue();
    }

    @Test
    @DisplayName("a fully translated page is complete")
    void fullyTranslated() {
        Fixture fx = newFixture("tfull");
        enableLocales(fx);
        UUID page = page(fx, template(fx), "About", 4);

        TranslationStatus status = translationStatus.of(fx.project().getId(), page);

        assertThat(status.incomplete()).isFalse();
        assertThat(status.locales()).allSatisfy(locale -> assertThat(locale.complete()).isTrue());
    }

    @Test
    @DisplayName("only fields the default language fills count — an empty field owes nothing")
    void emptyFieldsAreNotOwed() {
        Fixture fx = newFixture("tempty");
        enableLocales(fx);
        TemplateView template = template(fx);
        AssetVersionView page = pageService.create(new CreatePageCommand("About", null, template.uuid()), fx.ctx());
        ObjectNode payload = (ObjectNode) page.payload().deepCopy();
        payload.putObject("content")
                .set("headline", L10nValues.wrap(JsonNodeFactory.instance.textNode("Nur Deutsch"), "de"));
        pageService.update(page.uuid(), payload, page.validFromRevision(), fx.ctx());

        TranslationStatus status = translationStatus.of(fx.project().getId(), page.uuid());

        // One of four fields is filled, so only that one is owed.
        assertThat(status.locales())
                .contains(new TranslationStatus.LocaleStatus("en", 1, 1));
    }

    @Test
    @DisplayName("a section instance's fields count toward the page that holds it")
    void sectionFieldsCountTowardThePage() {
        Fixture fx = newFixture("tsect");
        enableLocales(fx);
        TemplateView section = templateService.create(
                new CreateTemplateCommand(
                        fx.project().getId(), AssetType.SECTION_TEMPLATE, "Teaser",
                        CdlSources.split("content { editor text headline { label \"Headline\" localizable } }"),
                        Map.of("html", "<p>$CMS_VALUE(headline)$</p>"), null, false, Map.of()),
                fx.ctx());
        TemplateView pageTemplate = templateService.create(
                new CreateTemplateCommand(
                        fx.project().getId(), AssetType.PAGE_TEMPLATE, "WithBody",
                        CdlSources.split("content { }\nbodies { body main { label \"Main\" allow [\"*\"] } }"),
                        Map.of("html", "$CMS_BODY(main)$"), null, false, Map.of()),
                fx.ctx());
        AssetVersionView page = pageService.create(new CreatePageCommand("Host", null, pageTemplate.uuid()), fx.ctx());
        ObjectNode payload = (ObjectNode) page.payload().deepCopy();
        ObjectNode instance = payload.putObject("bodies").putArray("main").addObject();
        instance.put("instanceId", UUID.randomUUID().toString());
        instance.put("templateRef", section.uuid().toString());
        instance.putObject("content")
                .set("headline", L10nValues.wrap(JsonNodeFactory.instance.textNode("Nur Deutsch"), "de"));
        pageService.update(page.uuid(), payload, page.validFromRevision(), fx.ctx());

        TranslationStatus status = translationStatus.of(fx.project().getId(), page.uuid());

        assertThat(status.locales()).contains(new TranslationStatus.LocaleStatus("en", 1, 1));
    }

    @Test
    @DisplayName("values of a removed language are listed as orphaned")
    void orphanedLanguagesAreListed() {
        Fixture fx = newFixture("torph");
        enableLocales(fx);
        TemplateView template = template(fx);
        AssetVersionView page = pageService.create(new CreatePageCommand("About", null, template.uuid()), fx.ctx());
        ObjectNode payload = (ObjectNode) page.payload().deepCopy();
        ObjectNode wrapper = L10nValues.wrap(JsonNodeFactory.instance.textNode("Deutsch"), "de");
        payload.putObject("content")
                .set("headline", L10nValues.with(wrapper, "en", JsonNodeFactory.instance.textNode("English")));
        pageService.update(page.uuid(), payload, page.validFromRevision(), fx.ctx());

        projectService.updateLocales(
                fx.project().getKey(),
                LocaleConfig.of(List.of(new ProjectLocale("de", "Deutsch")), "de", Map.of(), false),
                true,
                fx.ctx());

        assertThat(translationStatus.of(fx.project().getId(), page.uuid()).orphaned()).containsExactly("en");
    }

    @Test
    @DisplayName("a project without languages reports nothing at all")
    void noLanguagesNoStatus() {
        Fixture fx = newFixture("tnone");
        TemplateView template = template(fx);
        AssetVersionView page = pageService.create(new CreatePageCommand("About", null, template.uuid()), fx.ctx());

        TranslationStatus status = translationStatus.of(fx.project().getId(), page.uuid());

        assertThat(status.locales()).isEmpty();
        assertThat(status.incomplete()).isFalse();
        assertThat(translationStatus.ofProject(fx.project().getId(), null)).isEmpty();
    }

    @Test
    @DisplayName("the project listing finds exactly the incomplete pages")
    void projectListing() {
        Fixture fx = newFixture("tlist");
        enableLocales(fx);
        TemplateView template = template(fx);
        UUID complete = page(fx, template, "Complete", 4);
        UUID incomplete = page(fx, template, "Incomplete", 1);

        List<TranslationStatus> all = translationStatus.ofProject(fx.project().getId(), AssetType.PAGE);

        assertThat(all).extracting(TranslationStatus::assetUuid).contains(complete, incomplete);
        assertThat(all.stream().filter(TranslationStatus::incomplete).map(TranslationStatus::assetUuid))
                .containsExactly(incomplete);
    }
}
