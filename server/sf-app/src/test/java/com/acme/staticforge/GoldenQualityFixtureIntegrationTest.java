package com.acme.staticforge;

import static org.assertj.core.api.Assertions.assertThat;

import com.acme.staticforge.BuildInsightFixtures.Fixture;
import com.acme.staticforge.asset.AssetRepository;
import com.acme.staticforge.asset.AssetService;
import com.acme.staticforge.asset.AssetType;
import com.acme.staticforge.asset.AssetVersionView;
import com.acme.staticforge.asset.media.MediaService;
import com.acme.staticforge.asset.navigation.PageReferenceService;
import com.acme.staticforge.asset.template.CreateTemplateCommand;
import com.acme.staticforge.asset.template.TemplateService;
import com.acme.staticforge.asset.template.TemplateView;
import com.acme.staticforge.channel.ChannelService;
import com.acme.staticforge.channel.CreateChannelRequest;
import com.acme.staticforge.common.L10nValues;
import com.acme.staticforge.generate.GenerationMode;
import com.acme.staticforge.generate.GenerationRequest;
import com.acme.staticforge.generate.GenerationRun;
import com.acme.staticforge.generate.GenerationService;
import com.acme.staticforge.generate.GenerationTarget;
import com.acme.staticforge.generate.GenerationTargetRepository;
import com.acme.staticforge.generate.RunStatus;
import com.acme.staticforge.generate.quality.QualityRuleConfigService;
import com.acme.staticforge.generate.quality.RunFindingStore;
import com.acme.staticforge.generate.quality.RunFindingStore.StoredFinding;
import com.acme.staticforge.generate.target.BuildManifest;
import com.acme.staticforge.project.LocaleConfig;
import com.acme.staticforge.project.ProjectLocale;
import com.acme.staticforge.project.ProjectService;
import com.acme.staticforge.release.ReleaseItem;
import com.acme.staticforge.release.ReleaseService;
import com.acme.staticforge.revision.RevisionContext;
import com.acme.staticforge.template.cdl.CdlSources;
import com.acme.staticforge.user.UserService;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.awt.image.BufferedImage;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.UncheckedIOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.TreeSet;
import java.util.UUID;
import java.util.function.Consumer;
import java.util.stream.Collectors;
import javax.imageio.ImageIO;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

/**
 * The golden quality fixture (M30.2, epic exit criterion 1): one real site — languages {@code de}, {@code en} and
 * {@code de-CH} (falling back to {@code de}), an HTML and a Markdown channel, a layout every page template extends, a
 * paginated news page, a media image — built end to end with the production rule set at its defaults. Its pages seed
 * every defect the epic lists (broken page and media link, missing anchor, links to an unreleased and to a deleted page,
 * missing title, description and {@code h1}, duplicate title, missing alt, heading skip, duplicate id, unlabeled input,
 * untitled iframe, missing {@code lang}, a {@code noIndex} page without robots meta); the other pages are clean.
 *
 * <p>The stored findings must equal {@code quality/expected-findings.json} exactly: output path, channel, locale, page,
 * code, severity, selector and — where the file states one — message. The file is sorted and one finding per line.
 * Regenerate it after a deliberate change with {@code -Dsf.quality.golden.update=true} (or
 * {@code SF_QUALITY_GOLDEN_UPDATE=true}) and review the diff; without it the test only compares.
 */
@SpringBootTest
@ActiveProfiles("test")
class GoldenQualityFixtureIntegrationTest {

    /** The expected findings, in the source tree (the test's working directory is the module). */
    private static final Path EXPECTED = Path.of("src", "test", "resources", "quality", "expected-findings.json");

    private static final String UPDATE_PROPERTY = "sf.quality.golden.update";
    private static final String UPDATE_ENV = "SF_QUALITY_GOLDEN_UPDATE";

    private static final String PATTERN = "{locale}/{displayNameSlug}.{ext}";

    /** Every defect the epic's first exit criterion names, by the code that reports it. */
    private static final Set<String> SEEDED = Set.of(
            "SF-CHK-0101", // broken page link
            "SF-CHK-0102", // broken media link
            "SF-CHK-0104", // link to an unreleased page
            "SF-CHK-0105", // link to a deleted page
            "SF-CHK-0107", // missing anchor
            "SF-CHK-0201", // missing title
            "SF-CHK-0203", // missing description
            "SF-CHK-0205", // duplicate title
            "SF-CHK-0207", // missing h1
            "SF-CHK-0212", // noIndex page without robots meta
            "SF-CHK-0301", // missing alt
            "SF-CHK-0304", // heading skip
            "SF-CHK-0305", // duplicate id
            "SF-CHK-0306", // unlabeled input
            "SF-CHK-0307", // untitled iframe
            "SF-CHK-0308"); // missing lang

    private static final ObjectMapper MAPPER = new ObjectMapper();

    private static Path outputRoot;

    @DynamicPropertySource
    static void configure(DynamicPropertyRegistry registry) throws IOException {
        outputRoot = Files.createTempDirectory("sf-m30-golden");
        registry.add("sf.generate.output-root", outputRoot::toString);
    }

    @Autowired UserService userService;
    @Autowired ProjectService projectService;
    @Autowired AssetService assetService;
    @Autowired AssetRepository assetRepository;
    @Autowired TemplateService templateService;
    @Autowired MediaService mediaService;
    @Autowired PageReferenceService pageReferenceService;
    @Autowired ChannelService channelService;
    @Autowired GenerationTargetRepository targetRepository;
    @Autowired GenerationService generationService;
    @Autowired ReleaseFixtures releaseFixtures;
    @Autowired ReleaseService releaseService;
    @Autowired QualityRuleConfigService configService;
    @Autowired RunFindingStore findingStore;

    private BuildInsightFixtures build;
    private QualityBuildFixtures q;

    @BeforeEach
    void setUp() {
        build = new BuildInsightFixtures(userService, projectService, assetService, assetRepository, templateService,
                mediaService, pageReferenceService, targetRepository, generationService, releaseFixtures, outputRoot);
        q = new QualityBuildFixtures(build, configService, findingStore, outputRoot);
    }

    @Test
    void aFullBuildOfTheGoldenSiteReportsExactlyTheSeededFindings() throws IOException {
        Site site = site();

        GenerationRun run = build.generate(site.fx(), new GenerationRequest(GenerationMode.FULL, null,
                List.of("html", "md"), site.target().getId(), null, null, null, null));

        // The references to the unreleased and the deleted page keep their render warnings (decision 8): PARTIAL, but
        // nothing is held back — every rule is at its default, WARNING.
        assertThat(run.getStatus()).as("diagnostics: %s", run.getDiagnostics()).isEqualTo(RunStatus.PARTIAL);
        assertThat(run.getDiagnostics().path("errors")).as("diagnostics: %s", run.getDiagnostics()).isEmpty();
        assertThat(codes(run.getDiagnostics().path("warnings")))
                .as("diagnostics: %s", run.getDiagnostics())
                .containsExactlyInAnyOrder("SF-GEN-0220", "SF-GEN-0221");

        List<StoredFinding> findings = q.findings(site.fx(), run);
        List<Map<String, Object>> actual = findings.stream()
                .map(GoldenQualityFixtureIntegrationTest::entry)
                .sorted(ORDER)
                .toList();
        if (updateRequested()) {
            Files.writeString(EXPECTED, render(actual), StandardCharsets.UTF_8);
        }

        assertThat(EXPECTED).as("run with -D%s=true to create it", UPDATE_PROPERTY).exists();
        List<Map<String, Object>> expected = parse(Files.readString(EXPECTED, StandardCharsets.UTF_8));
        assertThat(comparable(actual, expected))
                .as("stored findings vs %s (regenerate with -D%s=true and review the diff)", EXPECTED, UPDATE_PROPERTY)
                .containsExactlyElementsOf(expected);

        // The file itself stays honest: sorted, and every seeded defect is in it.
        assertThat(expected).isSortedAccordingTo(ORDER);
        assertThat(expected).extracting(entry -> (String) entry.get("code")).containsAll(SEEDED);

        // Nothing on the clean pages, in any channel, language or page number — and they really were built.
        BuildManifest manifest = q.manifest(site.fx(), site.target(), run).orElseThrow();
        Set<String> cleanPaths = manifest.outputs().stream()
                .filter(output -> site.clean().contains(output.asset()))
                .map(BuildManifest.Output::path)
                .collect(Collectors.toCollection(TreeSet::new));
        assertThat(cleanPaths).contains("de/home.html", "en/news-2.html", "de-CH/news-2.html", "en/post-3.html",
                "de/private.html", "en/home.md", "de-CH/news-2.md");
        assertThat(findings).filteredOn(finding -> cleanPaths.contains(finding.outputPath())).isEmpty();
        // Markdown outputs are not checked (decision 2), though the layout's Markdown has a broken link.
        assertThat(findings).extracting(StoredFinding::channel).containsOnly("html");
        Path published = q.buildsDir(site.fx(), site.target()).resolve(String.valueOf(run.getId()));
        assertThat(published.resolve("de/broken-links.md")).content().contains("(discontinued.md)");
        // The clean image takes its alt text from the media (content); the defect page's template forgets it.
        assertThat(published.resolve("en/home.html")).content().contains("alt=\"Golden Hardware logo\"");
    }

    // ------------------------------------------------------------------
    // The site
    // ------------------------------------------------------------------

    private record Site(Fixture fx, GenerationTarget target, Set<UUID> clean) {}

    /**
     * Builds the golden site. Every page template extends {@code layout} (title, description, robots, hreflang
     * alternates from {@code CMS_LOCALES}, one {@code h1}); the defect templates override one block each.
     */
    private Site site() {
        Fixture fx = q.project("golden");
        projectService.updateLocales(fx.project().getKey(), LocaleConfig.of(
                List.of(new ProjectLocale("de", "Deutsch"), new ProjectLocale("en", "English"),
                        new ProjectLocale("de-CH", "Deutsch (Schweiz)")),
                "de", Map.of("de-CH", List.of("de")), false), true, fx.ctx());
        channelService.create(new CreateChannelRequest(
                "md", "Markdown", "md", "text/markdown", "MARKDOWN", true, false, 1, null, null), fx.ctx());
        GenerationTarget target = q.target(fx, "golden");

        AssetVersionView logo = mediaService.upload(fx.projectId(), null, "logo.png", "image/png",
                "Golden Hardware logo", null, png(), fx.ctx());

        String layoutCdl = """
                content {
                  editor text title { label "Title" localizable }
                  editor text description { label "Description" localizable }
                  editor text intro { label "Intro" localizable }
                }
                """;
        template(fx, "Layout", layoutCdl, "layout.html", "layout.md", true, null);
        TemplateView standard = template(fx, "Standard", "", "standard.html");
        TemplateView home = template(fx, "Home page", """
                content {
                  editor media image { label "Image" }
                  editor link about { label "About" }
                  editor link news { label "News" }
                }
                """, "home.html");
        TemplateView about = template(fx, "About page", "", "about.html");
        TemplateView news = template(fx, "News page", """
                content {
                  editor pagination posts { label "Posts" sources ["nav"] pageSize 2 maxPageSize 20 sort ["navigation"] }
                }
                """, "news.html");
        TemplateView brokenLinks = template(fx, "Broken links page", """
                content {
                  editor link about { label "About" }
                  editor link draft { label "Draft" }
                  editor link retired { label "Retired" }
                }
                """, "broken-links.html");
        TemplateView untitled = template(fx, "Untitled page", "", "untitled.html");
        TemplateView openingHours = template(fx, "Opening hours page", """
                content {
                  editor media image { label "Image" }
                }
                """, "opening-hours.html");
        TemplateView noLang = template(fx, "No lang page", "", "no-lang.html");
        TemplateView noRobots = template(fx, "No robots page", "", "no-robots.html");

        // Clean pages.
        UUID navRoot = build.navigationRoot(fx);
        List<UUID> posts = new ArrayList<>();
        for (int i = 1; i <= 3; i++) {
            AssetVersionView post = page(fx, "Post " + i, standard, text(
                    "Werkstattbericht Nummer " + i, "Workshop report number " + i,
                    "Was in der Werkstatt diese Woche geschah, Bericht Nummer " + i + " der Reihe.",
                    "What happened in the workshop this week, report number " + i + " of the series."), null);
            build.pageReference(fx, "0" + i + " post", navRoot, post.uuid());
            posts.add(post.uuid());
        }
        AssetVersionView aboutPage = page(fx, "About", about, text(
                "Über Golden Hardware", "About Golden Hardware",
                "Wer wir sind: eine kleine Eisenwarenhandlung mit eigener Werkstatt seit 1952.",
                "Who we are: a small hardware store with its own workshop since 1952."), null);
        AssetVersionView newsPage = page(fx, "News", news, text(
                "Neuigkeiten aus der Werkstatt", "News from the workshop",
                "Alle Berichte aus der Werkstatt von Golden Hardware, die neuesten zuerst.",
                "Every report from the Golden Hardware workshop, the newest first."), payload -> {
                    ObjectNode postsEditor = payload.withObject("content").putObject("posts").put("type", "PAGINATION");
                    postsEditor.putObject("source").put("kind", "NAV").put("uuid", navRoot.toString());
                    postsEditor.put("pageSize", 2);
                    postsEditor.putObject("sort").put("key", "navigation").put("direction", "ASC");
                });
        AssetVersionView homePage = page(fx, "Home", home, text(
                "Willkommen bei Golden Hardware", "Welcome to Golden Hardware",
                "Golden Hardware: Werkzeug, Beschläge und eine Werkstatt, die repariert, was Sie bringen.",
                "Golden Hardware: tools, fittings and a workshop that repairs whatever you bring in."), payload -> {
                    ObjectNode content = payload.withObject("content");
                    content.set("image", build.mediaRef(logo.uuid()));
                    content.set("about", link(aboutPage.uuid()));
                    content.set("news", link(newsPage.uuid()));
                });
        AssetVersionView privatePage = page(fx, "Private", standard, text(
                "Interne Preisliste für Händler", "Internal price list for dealers",
                "Nur für Händler: die aktuelle Preisliste, nicht für Suchmaschinen bestimmt.",
                "For dealers only: the current price list, not meant for search engines."),
                payload -> payload.withObject("nav").put("noIndex", true));

        // The targets of the broken links: one that won't be released, one that will be deleted.
        AssetVersionView draft = page(fx, "Draft", standard, text(
                "Entwurf der Herbstaktion", "Draft of the autumn sale",
                "Die Herbstaktion ist noch nicht freigegeben und darf nicht verlinkt werden.",
                "The autumn sale isn't released yet and must not be linked from anywhere."), null);
        AssetVersionView retired = page(fx, "Retired", standard, text(
                "Ausgelaufenes Sortiment", "Discontinued products",
                "Das ausgelaufene Sortiment wurde entfernt, Links darauf laufen ins Leere.",
                "The discontinued range has been removed, links to it lead nowhere at all."), null);

        // Defect pages.
        page(fx, "Broken links", brokenLinks, text(
                "Seite mit kaputten Links", "Page with broken links",
                "Diese Seite verlinkt Seiten, Medien und Anker, die es im Build nicht gibt.",
                "This page links pages, media and anchors that the build doesn't contain."), payload -> {
                    ObjectNode content = payload.withObject("content");
                    content.set("about", link(aboutPage.uuid()));
                    content.set("draft", link(draft.uuid()));
                    content.set("retired", link(retired.uuid()));
                });
        page(fx, "Untitled", untitled, text(
                "Ohne Titel", "Without a title", "Nie ausgegeben.", "Never rendered."), null);
        page(fx, "Opening hours", openingHours, text(
                "Öffnungszeiten der Werkstatt", "Opening hours of the workshop",
                "Wann die Werkstatt von Golden Hardware geöffnet hat, mit Karte und Suche.",
                "When the Golden Hardware workshop is open, with a map and a search field."),
                payload -> payload.withObject("content").set("image", build.mediaRef(logo.uuid())));
        page(fx, "No language", noLang, text(
                "Seite ohne Sprachangabe", "Page without a language",
                "Das html-Element dieser Seite hat kein lang-Attribut, Screenreader raten.",
                "The html element of this page has no lang attribute, screen readers guess."), null);
        page(fx, "Hidden", noRobots, text(
                "Versteckte Seite ohne Robots", "Hidden page without robots",
                "Diese Seite soll nicht indexiert werden, sagt es Suchmaschinen aber nicht.",
                "This page must not be indexed but doesn't tell search engines about it."),
                payload -> payload.withObject("nav").put("noIndex", true));
        // Content defects: the English titles of the twins are the same; Contact has an English description only,
        // so German and Swiss German (falling back to German) have none.
        page(fx, "Twin A", standard, text(
                "Zwilling A der Werkstatt", "Twin pages share a title",
                "Der erste Zwilling: eine Seite, deren englischer Titel doppelt vorkommt.",
                "The first twin: a page whose English title is used by another page too."), null);
        page(fx, "Twin B", standard, text(
                "Zwilling B der Werkstatt", "Twin pages share a title",
                "Der zweite Zwilling: eine Seite, deren englischer Titel doppelt vorkommt.",
                "The second twin: a page whose English title is used by another page too."), null);
        page(fx, "Contact", standard, payload -> {
            ObjectNode content = payload.withObject("content");
            content.set("title", l10n("Kontakt und Anfahrt", "Contact and directions"));
            content.set("description", l10n(null,
                    "How to reach Golden Hardware: address, phone, e-mail and parking nearby."));
            content.set("intro", l10n("Schreiben Sie uns.", "Write to us."));
        }, null);

        releaseFixtures.releaseAll(fx.projectId());
        releaseService.unpublish(List.of(ReleaseItem.of(draft.uuid())),
                RevisionContext.of(fx.projectId(), null, "golden fixture"));
        assetService.softDelete(retired.uuid(), true, fx.ctx());

        // The pages that seed nothing: none of their outputs may have a finding.
        Set<UUID> clean = new java.util.HashSet<>(posts);
        clean.addAll(List.of(homePage.uuid(), aboutPage.uuid(), newsPage.uuid(), privatePage.uuid()));
        return new Site(fx, target, clean);
    }

    /** A page template on a fixture source, with the shared Markdown child source. */
    private TemplateView template(Fixture fx, String name, String cdl, String html) {
        return template(fx, name, cdl, html, "page.md", false, null);
    }

    private TemplateView template(
            Fixture fx, String name, String cdl, String html, String md, boolean abstractTemplate,
            Map<String, String> paginationPath) {
        return templateService.create(new CreateTemplateCommand(fx.projectId(), AssetType.PAGE_TEMPLATE, name, CdlSources.split(cdl),
                Map.of("html", source(html), "md", source(md)), null, false,
                Map.of("html", PATTERN, "md", PATTERN), null, abstractTemplate, paginationPath), fx.ctx());
    }

    /** A page on {@code template} with the layout's localized texts, then {@code customizer}. */
    private AssetVersionView page(
            Fixture fx, String name, TemplateView template, Consumer<ObjectNode> texts, Consumer<ObjectNode> customizer) {
        return build.page(fx, name, template.uuid(), payload -> {
            texts.accept(payload);
            if (customizer != null) {
                customizer.accept(payload);
            }
        });
    }

    /** Title, description and intro in {@code de} and {@code en}; {@code de-CH} falls back to {@code de}. */
    private static Consumer<ObjectNode> text(String titleDe, String titleEn, String descriptionDe, String descriptionEn) {
        return payload -> {
            ObjectNode content = payload.withObject("content");
            content.set("title", l10n(titleDe, titleEn));
            content.set("description", l10n(descriptionDe, descriptionEn));
            content.set("intro", l10n(titleDe + ".", titleEn + "."));
        };
    }

    private static ObjectNode l10n(String de, String en) {
        ObjectNode wrapper = L10nValues.empty();
        if (de != null) {
            wrapper.withObject("values").put("de", de);
        }
        if (en != null) {
            wrapper.withObject("values").put("en", en);
        }
        return wrapper;
    }

    /** A link editor value to a page (an internal link carries no anchor: templates add one after the href). */
    private static ObjectNode link(UUID target) {
        return MAPPER.createObjectNode().put("kind", "INTERNAL").put("uuid", target.toString());
    }

    private static String source(String name) {
        try (InputStream in = GoldenQualityFixtureIntegrationTest.class.getResourceAsStream("/quality/golden/" + name)) {
            Objects.requireNonNull(in, "missing fixture quality/golden/" + name);
            // Checked out with CRLF or LF: the rendered bytes (and so the selectors) must not depend on it.
            return new String(in.readAllBytes(), StandardCharsets.UTF_8).replace("\r\n", "\n");
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
    }

    private static byte[] png() {
        BufferedImage image = new BufferedImage(4, 4, BufferedImage.TYPE_INT_RGB);
        image.setRGB(1, 1, 0xC8A200);
        try (ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            ImageIO.write(image, "png", out);
            return out.toByteArray();
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
    }

    private static List<String> codes(JsonNode diagnostics) {
        List<String> codes = new ArrayList<>();
        diagnostics.forEach(diagnostic -> codes.add(diagnostic.path("code").asText()));
        return codes;
    }

    // ------------------------------------------------------------------
    // The expected-findings file
    // ------------------------------------------------------------------

    /** Sorted by output path, channel, locale, code, selector, message. */
    private static final Comparator<Map<String, Object>> ORDER = Comparator
            .comparing((Map<String, Object> entry) -> string(entry, "path"))
            .thenComparing(entry -> string(entry, "channel"))
            .thenComparing(entry -> string(entry, "locale"))
            .thenComparing(entry -> string(entry, "code"))
            .thenComparing(entry -> string(entry, "selector"))
            .thenComparing(entry -> string(entry, "message"));

    private static String string(Map<String, Object> entry, String key) {
        Object value = entry.get(key);
        return value == null ? "" : value.toString();
    }

    /** One finding as the file states it; absent values are left out. */
    private static Map<String, Object> entry(StoredFinding finding) {
        Map<String, Object> entry = new LinkedHashMap<>();
        entry.put("path", finding.outputPath());
        entry.put("channel", finding.channel());
        entry.put("locale", finding.locale());
        entry.put("page", finding.uid());
        entry.put("code", finding.code());
        entry.put("severity", finding.severity().name());
        if (finding.selector() != null) {
            entry.put("selector", finding.selector());
        }
        entry.put("message", finding.message());
        entry.values().removeIf(Objects::isNull);
        return entry;
    }

    /**
     * {@code actual} with the message left out wherever the file states the finding without one — a message is
     * optional in the file, everything else must match.
     */
    private static List<Map<String, Object>> comparable(
            List<Map<String, Object>> actual, List<Map<String, Object>> expected) {
        Set<Map<String, Object>> withoutMessage = expected.stream()
                .filter(entry -> !entry.containsKey("message"))
                .collect(Collectors.toSet());
        return actual.stream()
                .map(entry -> {
                    Map<String, Object> stripped = new LinkedHashMap<>(entry);
                    stripped.remove("message");
                    return withoutMessage.contains(stripped) ? stripped : entry;
                })
                .sorted(ORDER)
                .toList();
    }

    /** A JSON array with one finding per line, so a diff shows exactly the findings that changed. */
    private static String render(List<Map<String, Object>> entries) throws IOException {
        StringBuilder out = new StringBuilder("[\n");
        for (int i = 0; i < entries.size(); i++) {
            out.append("  ").append(MAPPER.writeValueAsString(entries.get(i)))
                    .append(i + 1 < entries.size() ? ",\n" : "\n");
        }
        return out.append("]\n").toString();
    }

    private static List<Map<String, Object>> parse(String json) throws IOException {
        return MAPPER.readValue(json, new TypeReference<List<LinkedHashMap<String, Object>>>() {}).stream()
                .map(entry -> (Map<String, Object>) entry)
                .toList();
    }

    private static boolean updateRequested() {
        return Boolean.parseBoolean(System.getProperty(UPDATE_PROPERTY))
                || Boolean.parseBoolean(System.getenv(UPDATE_ENV));
    }
}
