package com.acme.staticforge;

import static org.assertj.core.api.Assertions.assertThat;

import com.acme.staticforge.asset.AssetService;
import com.acme.staticforge.asset.AssetType;
import com.acme.staticforge.asset.AssetVersionView;
import com.acme.staticforge.asset.folder.FolderService;
import com.acme.staticforge.asset.page.CreatePageCommand;
import com.acme.staticforge.asset.page.PageService;
import com.acme.staticforge.asset.template.CreateTemplateCommand;
import com.acme.staticforge.asset.template.TemplateService;
import com.acme.staticforge.asset.template.TemplateView;
import com.acme.staticforge.common.L10nValues;
import com.acme.staticforge.generate.GenerationMode;
import com.acme.staticforge.generate.GenerationRequest;
import com.acme.staticforge.generate.GenerationRun;
import com.acme.staticforge.generate.GenerationService;
import com.acme.staticforge.generate.GenerationTarget;
import com.acme.staticforge.generate.GenerationTargetRepository;
import com.acme.staticforge.generate.RunStatus;
import com.acme.staticforge.generate.TargetLocations;
import com.acme.staticforge.generate.TargetType;
import com.acme.staticforge.preview.PageRenderService;
import com.acme.staticforge.preview.PreviewTokenService;
import com.acme.staticforge.project.CreateProjectRequest;
import com.acme.staticforge.project.LocaleConfig;
import com.acme.staticforge.project.Project;
import com.acme.staticforge.project.ProjectLocale;
import com.acme.staticforge.project.ProjectService;
import com.acme.staticforge.release.ContentView;
import com.acme.staticforge.revision.RevisionContext;
import com.acme.staticforge.template.cdl.CdlSources;
import com.acme.staticforge.user.AppUser;
import com.acme.staticforge.user.UserService;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Stream;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

/**
 * Generation of a localized project end to end (M24.3.2): one output per page × channel × language
 * under {@code {locale}}-prefixed paths, links that stay inside their language, {@code hreflang}
 * alternates in the sitemap, and an incremental run narrowed to the language that actually changed.
 */
@SpringBootTest
@ActiveProfiles("test")
class LocalizedGenerationIntegrationTest {

    private static final AtomicInteger SEQ = new AtomicInteger();

    /** Links are relative to the rendering page, so a link's target depends on where it sits. */
    private static final Pattern HREF = Pattern.compile("href=\"([^\"]+)\"");

    private static Path outputRoot;

    @DynamicPropertySource
    static void configure(DynamicPropertyRegistry registry) throws IOException {
        outputRoot = Files.createTempDirectory("sf-gen-l10n");
        registry.add("sf.generate.output-root", outputRoot::toString);
    }

    @Autowired UserService userService;
    @Autowired ProjectService projectService;
    @Autowired AssetService assetService;
    @Autowired FolderService folderService;
    @Autowired PageService pageService;
    @Autowired TemplateService templateService;
    @Autowired GenerationTargetRepository targetRepository;
    @Autowired GenerationService generationService;
    @Autowired ReleaseFixtures releaseFixtures;
    @Autowired PageRenderService pageRenderService;
    @Autowired PreviewTokenService previewTokenService;

    private final ObjectMapper mapper = new ObjectMapper();

    private record Fixture(Project project, AppUser user, RevisionContext ctx, GenerationTarget target) {}

    private Fixture newFixture(String prefix) throws Exception {
        int n = SEQ.incrementAndGet();
        AppUser user = userService.create(prefix + n, prefix + n + "@example.com", "L10n Gen", "secret-password");
        Project project = projectService.create(
                new CreateProjectRequest(prefix + n, prefix + n, null, "l10n generation"), user.getId());
        RevisionContext ctx = RevisionContext.of(project.getId(), user.getId(), "l10n generation");
        GenerationTarget target = targetRepository.save(new GenerationTarget(
                project.getId(),
                "default",
                TargetType.FILESYSTEM,
                mapper.readTree("{\"baseUrl\":\"https://example.com\"}"),
                true));
        return new Fixture(project, user, ctx, target);
    }

    private void enableLocales(Fixture fx, boolean defaultWithoutPrefix) {
        projectService.updateLocales(
                fx.project().getKey(),
                LocaleConfig.of(
                        List.of(new ProjectLocale("de", "Deutsch"), new ProjectLocale("en", "English")),
                        "de",
                        Map.of(),
                        defaultWithoutPrefix),
                true,
                fx.ctx());
    }

    private static final String ARTICLE_CDL =
            """
            content {
              editor text headline { label "Headline" localizable }
            }
            """;

    /** The language switcher and the `lang` attribute; no page reference yet, see {@link #linkPagesTogether}. */
    private static final String ARTICLE_HTML =
            "<html lang=\"$CMS_META(language)$\"><h1>$CMS_VALUE(headline)$</h1>"
                    + "$CMS_FOR(l : CMS_LOCALES)$<a href=\"$CMS_VALUE(l.href)$\">"
                    + "$CMS_VALUE(l.code)$</a>$CMS_END_FOR$</html>";

    /** A page template whose HTML prints the localizable headline and a language switcher. */
    private TemplateView template(Fixture fx) {
        return templateService.create(
                new CreateTemplateCommand(
                        fx.project().getId(),
                        AssetType.PAGE_TEMPLATE,
                        "Article",
                        CdlSources.split(ARTICLE_CDL),
                        Map.of("html", ARTICLE_HTML),
                        null,
                        false,
                        Map.of("html", "{locale}/{folder}{uid}.{ext}")),
                fx.ctx());
    }

    /**
     * Adds a {@code $CMS_REF(page:about)} link to the template. Done after the pages exist, because
     * a template only compiles once every reference in it resolves.
     */
    private void linkPagesTogether(Fixture fx, TemplateView template) {
        templateService.update(
                template.uuid(),
                new com.acme.staticforge.asset.template.UpdateTemplateCommand(
                        "Article",
                        CdlSources.split(ARTICLE_CDL),
                        Map.of(
                                "html",
                                ARTICLE_HTML.replace(
                                        "<h1>$CMS_VALUE(headline)$</h1>",
                                        "<h1>$CMS_VALUE(headline)$</h1><a href=\"$CMS_REF(page:about)$\">about</a>")),
                        null,
                        false,
                        Map.of("html", "{locale}/{folder}{uid}.{ext}"),
                        false,
                        Map.of()),
                assetService.requireCurrent(fx.project().getId(), template.uuid()).validFromRevision(),
                fx.ctx());
    }

    private UUID page(Fixture fx, TemplateView template, String name, UUID folder, Map<String, String> headlines) {
        AssetVersionView page = pageService.create(new CreatePageCommand(name, folder, template.uuid()), fx.ctx());
        ObjectNode payload = (ObjectNode) page.payload().deepCopy();
        ObjectNode wrapper = L10nValues.empty();
        headlines.forEach((locale, text) ->
                wrapper.withObject("/values").set(locale, JsonNodeFactory.instance.textNode(text)));
        payload.putObject("content").set("headline", wrapper);
        pageService.update(page.uuid(), payload, page.validFromRevision(), fx.ctx());
        return page.uuid();
    }

    private Path generate(Fixture fx, GenerationMode mode) throws Exception {
        releaseFixtures.releaseAll(fx.project().getKey());
        GenerationRun run = generationService.start(
                fx.project().getKey(),
                new GenerationRequest(mode, null, List.of("html"), fx.target().getId(), null, null, null, null),
                fx.user().getId());
        GenerationRun finished = awaitTerminal(fx.project().getKey(), run.getId());
        assertThat(finished.getStatus())
                .as("diagnostics: %s", finished.getDiagnostics())
                .isIn(RunStatus.SUCCESS, RunStatus.PARTIAL);
        return TargetLocations.resolve(outputRoot, fx.project().getKey(), fx.target())
                .resolve("builds")
                .resolve(String.valueOf(run.getId()));
    }

    private static List<String> relativeFiles(Path buildDir) throws IOException {
        try (Stream<Path> stream = Files.walk(buildDir)) {
            return stream.filter(Files::isRegularFile)
                    .map(path -> buildDir.relativize(path).toString().replace('\\', '/'))
                    .sorted()
                    .toList();
        }
    }

    @Test
    @DisplayName("every page is written once per language under its {locale} prefix")
    void writesOneOutputPerLanguage() throws Exception {
        Fixture fx = newFixture("l10ngen");
        enableLocales(fx, false);
        TemplateView template = template(fx);
        AssetVersionView folder = folderService.create(
                assetService.ensurePagesRootFolder(fx.project().getId(), fx.ctx()).uuid(), "pf", null, fx.ctx());
        page(fx, template, "about", null, Map.of("de", "Ueber uns", "en", "About us"));
        page(fx, template, "p2", folder.uuid(), Map.of("de", "Zwei", "en", "Two"));

        List<String> files = relativeFiles(generate(fx, GenerationMode.FULL));

        assertThat(files)
                .contains("de/about.html", "en/about.html", "de/pf/p2.html", "en/pf/p2.html");
    }

    @Test
    @DisplayName("the default language sits at the site root when the project says so")
    void defaultLanguageWithoutPrefix() throws Exception {
        Fixture fx = newFixture("l10nroot");
        enableLocales(fx, true);
        TemplateView template = template(fx);
        page(fx, template, "about", null, Map.of("de", "Ueber uns", "en", "About us"));

        List<String> files = relativeFiles(generate(fx, GenerationMode.FULL));

        assertThat(files).contains("about.html", "en/about.html");
        assertThat(files).doesNotContain("de/about.html");
    }

    @Test
    @DisplayName("links stay inside their language and resolve relative to the page that holds them")
    void linksStayInTheirLanguage() throws Exception {
        Fixture fx = newFixture("l10nlinks");
        enableLocales(fx, false);
        TemplateView template = template(fx);
        AssetVersionView folder = folderService.create(
                assetService.ensurePagesRootFolder(fx.project().getId(), fx.ctx()).uuid(), "pf", null, fx.ctx());
        page(fx, template, "about", null, Map.of("de", "Ueber uns", "en", "About us"));
        page(fx, template, "p2", folder.uuid(), Map.of("de", "Zwei", "en", "Two"));
        linkPagesTogether(fx, template);

        Path build = generate(fx, GenerationMode.FULL);

        // From en/pf/p2.html, the English "about" is two levels up and one across.
        assertThat(Files.readString(build.resolve("en/pf/p2.html"))).contains("href=\"../about.html\"");
        assertThat(Files.readString(build.resolve("de/pf/p2.html"))).contains("href=\"../about.html\"");
        // The language switcher on the German page points at the English one and vice versa.
        assertThat(Files.readString(build.resolve("de/about.html"))).contains("href=\"../en/about.html\"");
        assertThat(Files.readString(build.resolve("en/about.html"))).contains("href=\"../de/about.html\"");
        // …and the html lang attribute reports the render language.
        assertThat(Files.readString(build.resolve("en/about.html"))).contains("<html lang=\"en\">");
        assertThat(Files.readString(build.resolve("de/about.html"))).contains("<html lang=\"de\">");

        assertNoBrokenLinks(build);
    }

    @Test
    @DisplayName("$CMS_REF(page:x, locale=l) inside a CMS_LOCALES loop links another page in every language, in the build "
            + "and in the preview; a language the project doesn't have links in the render language")
    void languageLoopLinksAnotherPageInEveryLanguage() throws Exception {
        Fixture fx = newFixture("l10nloop");
        enableLocales(fx, false);
        TemplateView template = template(fx);
        AssetVersionView folder = folderService.create(
                assetService.ensurePagesRootFolder(fx.project().getId(), fx.ctx()).uuid(), "pf", null, fx.ctx());
        page(fx, template, "about", null, Map.of("de", "Ueber uns", "en", "About us"));
        UUID p2 = page(fx, template, "p2", folder.uuid(), Map.of("de", "Zwei", "en", "Two"));
        String loop = "<nav>$CMS_FOR(l : CMS_LOCALES)$<a href=\"$CMS_REF(page:about, locale=l)$\">about-$CMS_VALUE(l.code)$</a>"
                + "<a href=\"$CMS_REF(page:about, locale=l.code)$\">code-$CMS_VALUE(l.code)$</a>$CMS_END_FOR$"
                + "<a href=\"$CMS_REF(page:about, locale=\"fr\")$\">about-fr</a></nav>";
        templateService.update(
                template.uuid(),
                new com.acme.staticforge.asset.template.UpdateTemplateCommand(
                        "Article",
                        CdlSources.split(ARTICLE_CDL),
                        Map.of("html", ARTICLE_HTML.replace("</html>", loop + "</html>")),
                        null,
                        false,
                        Map.of("html", "{locale}/{folder}{uid}.{ext}"),
                        false,
                        Map.of()),
                assetService.requireCurrent(fx.project().getId(), template.uuid()).validFromRevision(),
                fx.ctx());

        Path build = generate(fx, GenerationMode.FULL);

        // Relative to {locale}/pf/p2.html: the same language's about is one level up, the other one across.
        for (String locale : List.of("de", "en")) {
            String html = Files.readString(build.resolve(locale + "/pf/p2.html"));
            String other = "de".equals(locale) ? "en" : "de";
            assertThat(html).as(locale).contains("<a href=\"../about.html\">about-" + locale + "</a>");
            assertThat(html).as(locale).contains("<a href=\"../about.html\">code-" + locale + "</a>");
            assertThat(html).as(locale).contains("<a href=\"../../" + other + "/about.html\">about-" + other + "</a>");
            assertThat(html).as(locale).contains("<a href=\"../../" + other + "/about.html\">code-" + other + "</a>");
            assertThat(html).as("an undeclared language links the render language (%s)", locale)
                    .contains("<a href=\"../about.html\">about-fr</a>");
        }
        assertNoBrokenLinks(build);

        String preview = pageRenderService
                .renderPage(fx.project().getId(), p2, null, "html", true, "http://localhost/api/v1", null, "de",
                        ContentView.Kind.PUBLISHED)
                .html();
        assertThat(previewLinkLocale(preview, "about-de")).isEqualTo("de");
        assertThat(previewLinkLocale(preview, "about-en")).isEqualTo("en");
        assertThat(previewLinkLocale(preview, "code-en")).isEqualTo("en");
        assertThat(previewLinkLocale(preview, "about-fr")).isEqualTo("de");
    }

    /** The language of the page a preview share link opens. */
    private String previewLinkLocale(String html, String label) {
        Matcher link = Pattern.compile("<a href=\"[^\"]*/preview/share\\?t=([^\"&]+)\">" + Pattern.quote(label) + "</a>")
                .matcher(html);
        assertThat(link.find()).as("a share link labeled %s in %s", label, html).isTrue();
        return previewTokenService.verifyShareToken(link.group(1)).locale();
    }

    @Test
    @DisplayName("the sitemap carries hreflang alternates and x-default")
    void sitemapHasAlternates() throws Exception {
        Fixture fx = newFixture("l10nmap");
        enableLocales(fx, false);
        TemplateView template = template(fx);
        page(fx, template, "about", null, Map.of("de", "Ueber uns", "en", "About us"));

        String sitemap = Files.readString(generate(fx, GenerationMode.FULL).resolve("sitemap.xml"));

        assertThat(sitemap).contains("xmlns:xhtml=\"http://www.w3.org/1999/xhtml\"");
        assertThat(sitemap).contains("hreflang=\"de\" href=\"https://example.com/de/about.html\"");
        assertThat(sitemap).contains("hreflang=\"en\" href=\"https://example.com/en/about.html\"");
        assertThat(sitemap).contains("hreflang=\"x-default\" href=\"https://example.com/de/about.html\"");
    }

    @Test
    @DisplayName("an output path without {locale} fails the run with SF-GEN-0111")
    void pathWithoutLocaleIsRejected() throws Exception {
        Fixture fx = newFixture("l10npath");
        enableLocales(fx, false);
        TemplateView template = templateService.create(
                new CreateTemplateCommand(
                        fx.project().getId(),
                        AssetType.PAGE_TEMPLATE,
                        "Flat",
                        CdlSources.split("content { editor text headline { label \"Headline\" } }"),
                        Map.of("html", "<h1>$CMS_VALUE(headline)$</h1>"),
                        null,
                        false,
                        Map.of("html", "{folder}{uid}.{ext}")),
                fx.ctx());
        List<String> uuids = new java.util.ArrayList<>();
        for (String name : List.of("about", "contact", "imprint")) {
            uuids.add(pageService.create(new CreatePageCommand(name, null, template.uuid()), fx.ctx()).uuid().toString());
        }

        releaseFixtures.releaseAll(fx.project().getKey());
        GenerationRun run = generationService.start(
                fx.project().getKey(),
                new GenerationRequest(GenerationMode.FULL, null, List.of("html"), fx.target().getId(), null, null, null, null),
                fx.user().getId());
        GenerationRun finished = awaitTerminal(fx.project().getKey(), run.getId());

        assertThat(finished.getStatus()).isEqualTo(RunStatus.FAILED);
        // One finding for the shared path, naming the pages by uid, name and path instead of their UUIDs (M35.1).
        com.fasterxml.jackson.databind.JsonNode group = finished.getDiagnostics().path("errors").get(0);
        assertThat(group.path("code").asText()).isEqualTo("SF-GEN-0111");
        assertThat(group.path("count").asInt()).isEqualTo(1);
        String message = group.path("messages").get(0).asText();
        assertThat(message)
                .contains("'{folder}{uid}.{ext}'", "channel html", "3 pages")
                .contains("'about' (about, /about)", "'contact' (contact, /contact)", "'imprint' (imprint, /imprint)");
        uuids.forEach(uuid -> assertThat(message).doesNotContain(uuid));
    }

    @Test
    @DisplayName("changing only the English headline rebuilds only the English output")
    void incrementalNarrowsToTheChangedLanguage() throws Exception {
        Fixture fx = newFixture("l10ninc");
        enableLocales(fx, false);
        TemplateView template = template(fx);
        page(fx, template, "about", null, Map.of("de", "Ueber uns", "en", "About us"));
        UUID second = page(fx, template, "contact", null, Map.of("de", "Kontakt", "en", "Contact"));
        generate(fx, GenerationMode.FULL);

        // Translate one page's English headline only.
        AssetVersionView current = assetService.requireCurrent(fx.project().getId(), second);
        ObjectNode payload = (ObjectNode) current.payload().deepCopy();
        ObjectNode content = (ObjectNode) payload.get("content");
        content.set(
                "headline",
                L10nValues.with(content.get("headline"), "en", JsonNodeFactory.instance.textNode("Contact us")));
        pageService.update(second, payload, current.validFromRevision(), fx.ctx());

        releaseFixtures.releaseAll(fx.project().getKey());
        GenerationRun run = generationService.start(
                fx.project().getKey(),
                new GenerationRequest(
                        GenerationMode.INCREMENTAL, null, List.of("html"), fx.target().getId(), null, null, null, null),
                fx.user().getId());
        GenerationRun finished = awaitTerminal(fx.project().getKey(), run.getId());

        assertThat(finished.getStatus()).isIn(RunStatus.SUCCESS, RunStatus.PARTIAL);
        // Exactly one output was planned: the English one of the one page that changed. Without the
        // narrowing this would be two — the page's German output would rebuild for nothing.
        assertThat(finished.getPlanSummary()).isNotNull();
        assertThat(finished.getPlanSummary().path("entryCount").asInt())
                .as("plan: %s", finished.getPlanSummary())
                .isEqualTo(1);
        assertThat(finished.getPlanSummary().path("pageCount").asInt()).isEqualTo(1);

        Path build = TargetLocations.resolve(outputRoot, fx.project().getKey(), fx.target())
                .resolve("builds")
                .resolve(String.valueOf(run.getId()));
        List<String> published = relativeFiles(build);
        // The published build is still a complete site: the rebuilt English output next to the
        // German one carried forward from the base build.
        assertThat(published).as("published files: %s", published).contains("en/contact.html", "de/contact.html");
        assertThat(Files.readString(build.resolve("en/contact.html"))).contains("Contact us");
        assertThat(Files.readString(build.resolve("de/contact.html"))).contains("Kontakt");
    }

    /**
     * Resolves every {@code href} of every generated page against the page that holds it and
     * asserts the target exists — the link check {@code tasks/lessons.md} requires for output-path
     * changes.
     */
    private static void assertNoBrokenLinks(Path buildDir) throws IOException {
        for (String file : relativeFiles(buildDir)) {
            if (!file.endsWith(".html")) {
                continue;
            }
            Path pageDir = buildDir.resolve(file).getParent();
            Matcher matcher = HREF.matcher(Files.readString(buildDir.resolve(file)));
            while (matcher.find()) {
                String href = matcher.group(1);
                if (href.isBlank() || href.startsWith("#") || href.contains(":")) {
                    continue;
                }
                Path target = pageDir.resolve(href).normalize();
                assertThat(Files.exists(target))
                        .as("%s links to %s, which resolves to %s", file, href, buildDir.relativize(target))
                        .isTrue();
            }
        }
    }

    private GenerationRun awaitTerminal(String projectKey, long runId) throws InterruptedException {
        Instant deadline = Instant.now().plus(Duration.ofSeconds(60));
        while (Instant.now().isBefore(deadline)) {
            GenerationRun run = generationService.status(projectKey, runId);
            RunStatus status = run.getStatus();
            if (status == RunStatus.SUCCESS
                    || status == RunStatus.PARTIAL
                    || status == RunStatus.FAILED
                    || status == RunStatus.CANCELLED) {
                return run;
            }
            Thread.sleep(100);
        }
        throw new AssertionError("Generation run " + runId + " did not reach a terminal state within 60s");
    }
}
