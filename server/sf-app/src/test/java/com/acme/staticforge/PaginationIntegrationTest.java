package com.acme.staticforge;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.acme.staticforge.asset.AssetService;
import com.acme.staticforge.asset.AssetType;
import com.acme.staticforge.asset.AssetVersionView;
import com.acme.staticforge.asset.ReferenceKind;
import com.acme.staticforge.asset.UpdateAssetCommand;
import com.acme.staticforge.asset.UsageView;
import com.acme.staticforge.asset.dataset.CreateDatasetCommand;
import com.acme.staticforge.asset.dataset.CreateRecordCommand;
import com.acme.staticforge.asset.dataset.DatasetService;
import com.acme.staticforge.asset.dataset.DatasetView;
import com.acme.staticforge.asset.dataset.RecordService;
import com.acme.staticforge.asset.dataset.RecordSetService;
import com.acme.staticforge.asset.folder.FolderScope;
import com.acme.staticforge.asset.folder.FolderService;
import com.acme.staticforge.asset.navigation.CreatePageReferenceCommand;
import com.acme.staticforge.asset.navigation.PageReferenceService;
import com.acme.staticforge.asset.navigation.PageReferenceTargetKind;
import com.acme.staticforge.asset.page.CreatePageCommand;
import com.acme.staticforge.asset.page.PageService;
import com.acme.staticforge.asset.template.CreateTemplateCommand;
import com.acme.staticforge.asset.template.TemplateService;
import com.acme.staticforge.asset.template.TemplateView;
import com.acme.staticforge.common.SfException;
import com.acme.staticforge.generate.GenerationMode;
import com.acme.staticforge.generate.GenerationRequest;
import com.acme.staticforge.generate.GenerationRun;
import com.acme.staticforge.generate.GenerationService;
import com.acme.staticforge.generate.GenerationTarget;
import com.acme.staticforge.generate.GenerationTargetRepository;
import com.acme.staticforge.generate.RunStatus;
import com.acme.staticforge.generate.TargetLocations;
import com.acme.staticforge.generate.TargetType;
import com.acme.staticforge.generate.plan.BuildPlan;
import com.acme.staticforge.generate.plan.BuildPlanner;
import com.acme.staticforge.generate.plan.PlanEntry;
import com.acme.staticforge.generate.render.OutputPathResolver;
import com.acme.staticforge.generate.snapshot.Snapshot;
import com.acme.staticforge.generate.snapshot.SnapshotService;
import com.acme.staticforge.generate.snapshot.SnapshotView;
import com.acme.staticforge.preview.PagePreview;
import com.acme.staticforge.preview.PageRenderService;
import com.acme.staticforge.project.CreateProjectRequest;
import com.acme.staticforge.project.LocaleConfig;
import com.acme.staticforge.project.Project;
import com.acme.staticforge.project.ProjectLocale;
import com.acme.staticforge.project.ProjectService;
import com.acme.staticforge.revision.RevisionContext;
import com.acme.staticforge.security.JwtService;
import com.acme.staticforge.user.AppUser;
import com.acme.staticforge.user.UserService;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Stream;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.HttpHeaders;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

/**
 * M21 pagination end to end through the services: declaring the editor, validating and storing a value, planning N
 * outputs, rendering slices and links (link-checked against the generated files), sitemap and search index, preview
 * pages, incremental rebuilds when the source changes, collisions and a dataset source.
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class PaginationIntegrationTest {

    private static final AtomicInteger SEQ = new AtomicInteger();

    private static final String BLOG_CDL = """
            content {
              editor text intro { label "Intro" }
              editor pagination posts { label "Posts" sources ["nav", "dataset"] pageSize 2 maxPageSize 20 sort ["navigation", "date", "name"] }
            }
            """;

    private static Path outputRoot;

    @DynamicPropertySource
    static void configure(DynamicPropertyRegistry registry) throws IOException {
        outputRoot = Files.createTempDirectory("sf-m21-pagination-test");
        registry.add("sf.generate.output-root", outputRoot::toString);
    }

    @Autowired UserService userService;
    @Autowired ProjectService projectService;
    @Autowired AssetService assetService;
    @Autowired FolderService folderService;
    @Autowired PageService pageService;
    @Autowired PageReferenceService pageReferenceService;
    @Autowired TemplateService templateService;
    @Autowired DatasetService datasetService;
    @Autowired RecordService recordService;
    @Autowired RecordSetService recordSetService;
    @Autowired GenerationTargetRepository targetRepository;
    @Autowired GenerationService generationService;
    @Autowired SnapshotService snapshotService;
    @Autowired ReleaseFixtures releaseFixtures;
    @Autowired BuildPlanner buildPlanner;
    @Autowired PageRenderService pageRenderService;
    @Autowired MockMvc mvc;
    @Autowired JwtService jwtService;

    private final ObjectMapper mapper = new ObjectMapper();

    @Test
    void declaringPaginationIsRestrictedToOneEditorPerPageTemplate() {
        Fixture fx = newFixture();

        assertThatThrownBy(() -> templateService.create(new CreateTemplateCommand(
                        fx.project().getId(), AssetType.SECTION_TEMPLATE, "List section",
                        "content { editor pagination posts { } }", Map.of("html", "x"), null, false, Map.of()),
                fx.ctx()))
                .isInstanceOf(SfException.class)
                .satisfies(e -> assertThat(diagnosticCodes((SfException) e)).containsExactly("SF-CDL-0110"));
        assertThatThrownBy(() -> pageTemplate(fx, "Twice", "content { editor pagination a { } editor pagination b { } }", "x"))
                .isInstanceOf(SfException.class)
                .satisfies(e -> assertThat(diagnosticCodes((SfException) e)).containsExactly("SF-CDL-0111"));
        assertThatThrownBy(() -> templateService.create(new CreateTemplateCommand(
                        fx.project().getId(), AssetType.PAGE_TEMPLATE, "Bad pattern", BLOG_CDL, Map.of("html", "x"), null, false,
                        Map.of(), null, false, Map.of("html", "{pagePath}-page.{ext}")),
                fx.ctx()))
                .isInstanceOf(SfException.class)
                .satisfies(e -> assertThat(((SfException) e).getProblem().getDetail()).contains("{pageNumber}"));
    }

    @Test
    void generatesPreviewsAndRebuildsAPaginatedNavigationListing() throws Exception {
        Fixture fx = newFixture();
        GenerationTarget target = createTarget(fx);

        // Five posts in the Pages store, listed by a navigation folder (reference names fix the tree order).
        TemplateView postTemplate = pageTemplate(fx, "Post", "content { editor text teaser { label \"Teaser\" } }",
                "<article>$CMS_VALUE(teaser)$</article>", Map.of("html", "{folder}{displayNameSlug}.{ext}"));
        AssetVersionView postsFolder = folderService.create(null, "Posts", FolderScope.PAGES, fx.ctx());
        AssetVersionView navFolder = folderService.create(null, "Blog Nav " + SEQ.incrementAndGet(), FolderScope.NAVIGATION, fx.ctx());
        List<AssetVersionView> posts = new ArrayList<>();
        List<AssetVersionView> references = new ArrayList<>();
        for (int i = 1; i <= 5; i++) {
            AssetVersionView post = pageService.create(new CreatePageCommand("Post " + i, postsFolder.uuid(), postTemplate.uuid()), fx.ctx());
            ObjectNode payload = post.payload().deepCopy();
            payload.putObject("content").put("teaser", "Teaser " + i);
            posts.add(pageService.update(post.uuid(), payload, post.validFromRevision(), fx.ctx()));
            references.add(pageReferenceService.create(
                    new CreatePageReferenceCommand("0" + i + " post", navFolder.uuid(), PageReferenceTargetKind.PAGE, post.uuid(), null),
                    fx.ctx()));
        }

        // A section template listing the items: sections inherit CMS_PAGINATION from the page.
        TemplateView listSection = templateService.create(new CreateTemplateCommand(
                        fx.project().getId(), AssetType.SECTION_TEMPLATE, "Post list " + SEQ.incrementAndGet(), "",
                        Map.of("html", "<ul>$CMS_FOR(post : CMS_PAGINATION.items)$<li><a class=\"item\" href=\"$CMS_VALUE(post.href)$\">"
                                + "$CMS_VALUE(post.displayName)$</a> $CMS_VALUE(post.content.teaser)$</li>$CMS_END_FOR$</ul>"),
                        null, false, Map.of()),
                fx.ctx());
        TemplateView blogTemplate = pageTemplate(fx, "Blog", BLOG_CDL, """
                <h1>$CMS_VALUE(intro)$ $CMS_META(pageNumber)$/$CMS_META(totalPages)$</h1>
                $CMS_INCLUDE(section_template:%s)$
                <link rel="canonical" href="$CMS_VALUE(CMS_PAGINATION.canonicalHref)$">
                $CMS_IF(CMS_PAGINATION.prevHref)$<a rel="prev" href="$CMS_VALUE(CMS_PAGINATION.prevHref)$">prev</a>$CMS_END_IF$
                $CMS_IF(CMS_PAGINATION.nextHref)$<a rel="next" href="$CMS_VALUE(CMS_PAGINATION.nextHref)$">next</a>$CMS_END_IF$
                $CMS_FOR(p : CMS_PAGINATION.pages)$<a class="page" href="$CMS_VALUE(p.href)$">$CMS_VALUE(p.number)$</a>$CMS_END_FOR$
                """.formatted(listSection.uid()), Map.of("html", "{folder}{displayNameSlug}.{ext}"));
        AssetVersionView newsFolder = folderService.create(null, "News", FolderScope.PAGES, fx.ctx());
        AssetVersionView blog = pageService.create(new CreatePageCommand("Blog", newsFolder.uuid(), blogTemplate.uuid()), fx.ctx());

        // Invalid values are rejected on save; a valid one is stored and becomes a usage of the folder.
        assertThatThrownBy(() -> savePagination(fx, blog, postsFolder.uuid(), "NAV", 2, "navigation"))
                .isInstanceOf(SfException.class);
        assertThatThrownBy(() -> savePagination(fx, blog, navFolder.uuid(), "NAV", 21, "navigation"))
                .isInstanceOf(SfException.class);
        assertThatThrownBy(() -> savePagination(fx, blog, navFolder.uuid(), "NAV", 2, "title"))
                .isInstanceOf(SfException.class);
        AssetVersionView savedBlog = savePagination(fx, blog, navFolder.uuid(), "NAV", 2, "navigation");
        assertThat(assetService.usages(fx.project().getId(), navFolder.uuid()))
                .extracting(UsageView::fromUuid, UsageView::kind, UsageView::sourcePath)
                .contains(org.assertj.core.groups.Tuple.tuple(blog.uuid(), ReferenceKind.CONTENT_REF, "content.posts.source"));

        // FULL: three outputs, page 1 at the page's own path.
        Path build = buildDir(fx, target, runToSuccess(fx, target, GenerationMode.FULL));
        assertThat(build.resolve("news/blog.html")).isRegularFile();
        assertThat(build.resolve("news/blog-2.html")).isRegularFile();
        assertThat(build.resolve("news/blog-3.html")).isRegularFile();
        String page2 = Files.readString(build.resolve("news/blog-2.html"));
        assertThat(itemLabels(page2)).containsExactly("Post 3", "Post 4");
        assertThat(page2).contains("Hello 2/3").contains("Teaser 3");
        assertThat(page2).contains("<a rel=\"prev\" href=\"blog.html\">").contains("<a rel=\"next\" href=\"blog-3.html\">");
        assertThat(page2).contains("<link rel=\"canonical\" href=\"blog-2.html\">");
        assertThat(itemLabels(Files.readString(build.resolve("news/blog-3.html")))).containsExactly("Post 5");
        assertThat(Files.readString(build.resolve("news/blog.html"))).doesNotContain("rel=\"prev\"");
        assertThat(Files.readString(build.resolve("news/blog-3.html"))).doesNotContain("rel=\"next\"");
        assertThat(brokenLinks(build)).isEmpty();

        String sitemap = Files.readString(build.resolve("sitemap.xml"));
        assertThat(sitemap).contains("https://example.com/news/blog.html", "https://example.com/news/blog-2.html",
                "https://example.com/news/blog-3.html");
        JsonNode searchIndex = mapper.readTree(Files.readString(build.resolve("search-index.json")));
        List<JsonNode> blogEntries = Stream.of(mapper.treeToValue(searchIndex, JsonNode[].class))
                .filter(entry -> entry.path("uid").asText().equals(blog.uid()))
                .toList();
        assertThat(blogEntries).extracting(entry -> entry.path("pageNumber").asInt()).containsExactlyInAnyOrder(1, 2, 3);
        assertThat(blogEntries).extracting(entry -> entry.path("title").asText()).contains("Blog – page 2");
        assertThat(Stream.of(mapper.treeToValue(searchIndex, JsonNode[].class)).filter(entry -> entry.has("pageNumber")))
                .hasSize(3);

        // Preview renders any page, clamped; page links stay inside the preview.
        PagePreview preview = pageRenderService.renderPage(fx.project().getId(), blog.uuid(), null, "html", true, "http://host/api/v1", 2);
        assertThat(preview.totalPages()).isEqualTo(3);
        assertThat(itemLabels(preview.html())).containsExactly("Post 3", "Post 4");
        assertThat(preview.html()).containsPattern("rel=\"next\" href=\"http://host/api/v1/projects/[^\"]+/preview/share\\?t=[^\"]+&amp;page=3\"");
        PagePreview clamped = pageRenderService.renderPage(fx.project().getId(), blog.uuid(), null, "html", true, "http://host/api/v1", 99);
        assertThat(clamped.pageNumber()).isEqualTo(3);
        assertThat(itemLabels(clamped.html())).containsExactly("Post 5");

        // INCREMENTAL: a target page's title reaches the listing through its reference.
        long baseline = head(fx);
        assetService.update(posts.get(0).uuid(), new UpdateAssetCommand("Post 1 renamed", posts.get(0).payload()),
                posts.get(0).validFromRevision(), fx.ctx());
        assertThat(plannedPages(fx, baseline)).contains(blog.uuid());
        assertThat(plannedEntries(fx, baseline, blog.uuid())).extracting(PlanEntry::pageNumber).containsExactlyInAnyOrder(1, 2, 3);

        // Removing a reference shrinks the listing to two pages: the incremental build publishes no blog-3.html.
        runToSuccess(fx, target, GenerationMode.FULL);
        baseline = head(fx);
        assetService.softDelete(references.get(4).uuid(), false, fx.ctx());
        assertThat(plannedEntries(fx, baseline, blog.uuid())).extracting(PlanEntry::pageNumber).containsExactlyInAnyOrder(1, 2);
        Path shrunk = buildDir(fx, target, runToSuccess(fx, target, GenerationMode.INCREMENTAL));
        assertThat(shrunk.resolve("news/blog.html")).isRegularFile();
        assertThat(shrunk.resolve("news/blog-2.html")).isRegularFile();
        assertThat(shrunk.resolve("news/blog-3.html")).doesNotExist();

        // Adding a reference to the folder rebuilds every page number.
        baseline = head(fx);
        pageReferenceService.create(
                new CreatePageReferenceCommand("06 post", navFolder.uuid(), PageReferenceTargetKind.PAGE, posts.get(4).uuid(), null),
                fx.ctx());
        assertThat(plannedEntries(fx, baseline, blog.uuid())).extracting(PlanEntry::pageNumber).containsExactlyInAnyOrder(1, 2, 3);

        // $CMS_REF to the paginated page targets page 1.
        TemplateView homeTemplate = pageTemplate(fx, "Home", "", "<a id=\"blog\" href=\"$CMS_REF(page:" + blog.uid() + ")$\">Blog</a>",
                Map.of("html", "index.html"));
        pageService.create(new CreatePageCommand("Home", null, homeTemplate.uuid()), fx.ctx());
        Path withHome = buildDir(fx, target, runToSuccess(fx, target, GenerationMode.FULL));
        assertThat(Files.readString(withHome.resolve("index.html"))).contains("href=\"news/blog.html\"");
        assertThat(brokenLinks(withHome)).isEmpty();

        // A page written onto page 2's path collides with it.
        pageService.create(new CreatePageCommand("Blog-2", newsFolder.uuid(), postTemplate.uuid()), fx.ctx());
        GenerationRun collided = run(fx, target, GenerationMode.FULL);
        assertThat(collided.getStatus()).isEqualTo(RunStatus.FAILED);
        assertThat(collided.getDiagnostics().toString()).contains("news/blog-2.html").contains(blog.uid() + " (page 2)");
        assertThat(savedBlog).isNotNull();
    }

    /**
     * In a project with languages every page number of a listing links its items in its own language (found by the
     * M30 golden quality fixture: the item links lacked the {@code {locale}} prefix, so every localized listing linked
     * pages that don't exist).
     */
    @Test
    void aLocalizedListingLinksItsItemsInItsOwnLanguage() throws Exception {
        Fixture fx = newFixture();
        projectService.updateLocales(fx.project().getKey(), LocaleConfig.of(
                List.of(new ProjectLocale("de", "Deutsch"), new ProjectLocale("en", "English"),
                        new ProjectLocale("de-CH", "Deutsch (Schweiz)")),
                "de", Map.of("de-CH", List.of("de")), false), true, fx.ctx());
        GenerationTarget target = createTarget(fx);
        Map<String, String> localized = Map.of("html", "{locale}/{folder}{displayNameSlug}.{ext}");
        TemplateView postTemplate = pageTemplate(fx, "Post", "", "<article>post</article>", localized);
        AssetVersionView postsFolder = folderService.create(null, "Posts", FolderScope.PAGES, fx.ctx());
        AssetVersionView navFolder = folderService.create(null, "Blog Nav " + SEQ.incrementAndGet(), FolderScope.NAVIGATION, fx.ctx());
        for (int i = 1; i <= 3; i++) {
            AssetVersionView post = pageService.create(new CreatePageCommand("Post " + i, postsFolder.uuid(), postTemplate.uuid()), fx.ctx());
            pageReferenceService.create(
                    new CreatePageReferenceCommand("0" + i + " post", navFolder.uuid(), PageReferenceTargetKind.PAGE, post.uuid(), null),
                    fx.ctx());
        }
        TemplateView blogTemplate = pageTemplate(fx, "Blog", BLOG_CDL,
                "<ul>$CMS_FOR(post : CMS_PAGINATION.items)$<li><a class=\"item\" href=\"$CMS_VALUE(post.href)$\">"
                        + "$CMS_VALUE(post.displayName)$</a></li>$CMS_END_FOR$</ul>"
                        + "$CMS_IF(CMS_PAGINATION.nextHref)$<a rel=\"next\" href=\"$CMS_VALUE(CMS_PAGINATION.nextHref)$\">next</a>$CMS_END_IF$",
                localized);
        AssetVersionView blog = pageService.create(new CreatePageCommand("Blog", null, blogTemplate.uuid()), fx.ctx());
        savePagination(fx, blog, navFolder.uuid(), "NAV", 2, "navigation");

        Path build = buildDir(fx, target, runToSuccess(fx, target, GenerationMode.FULL));

        assertThat(Files.readString(build.resolve("de/blog.html")))
                .contains("href=\"posts/post-1.html\">Post 1</a>", "href=\"posts/post-2.html\">Post 2</a>",
                        "<a rel=\"next\" href=\"blog-2.html\">");
        assertThat(Files.readString(build.resolve("en/blog-2.html"))).contains("href=\"posts/post-3.html\">Post 3</a>");
        assertThat(Files.readString(build.resolve("de-CH/blog-2.html"))).contains("href=\"posts/post-3.html\">Post 3</a>");
        assertThat(brokenLinks(build)).isEmpty();
    }

    @Test
    void paginatesADatasetAndRebuildsWhenARecordIsAdded() throws Exception {
        Fixture fx = newFixture();
        GenerationTarget target = createTarget(fx);
        DatasetView team = datasetService.create(new CreateDatasetCommand(
                fx.project().getId(), null, "Team " + SEQ.incrementAndGet(),
                "content { editor text name { label \"Name\" } }", "name", null), fx.ctx());
        UUID members = new RecordSetFixtures(recordSetService).setFor(fx.project().getId(), team.uuid(), null, fx.ctx());
        for (String name : List.of("Cy", "Ada", "Bo")) {
            recordService.create(new CreateRecordCommand(fx.project().getId(), members,
                    mapper.createObjectNode().put("name", name)), fx.ctx());
        }
        TemplateView template = pageTemplate(fx, "Team page", BLOG_CDL,
                "$CMS_FOR(m : CMS_PAGINATION.items)$[$CMS_VALUE(m.name)$]$CMS_END_FOR$ $CMS_VALUE(CMS_PAGINATION.nextHref)$",
                Map.of("html", "{displayNameSlug}.{ext}"));
        AssetVersionView page = pageService.create(new CreatePageCommand("Team", null, template.uuid()), fx.ctx());
        assertThatThrownBy(() -> savePagination(fx, page, team.uuid(), "DATASET", 2, "navigation")).isInstanceOf(SfException.class);
        savePagination(fx, page, team.uuid(), "DATASET", 2, "name");

        Path build = buildDir(fx, target, runToSuccess(fx, target, GenerationMode.FULL));
        assertThat(Files.readString(build.resolve("team.html"))).isEqualTo("[Ada][Bo] team-2.html");
        assertThat(Files.readString(build.resolve("team-2.html"))).isEqualTo("[Cy] ");

        // The preview API renders a page number, clamped, and tells the editor how many pages there are.
        String preview = "/api/v1/projects/" + fx.project().getKey() + "/preview/pages/" + page.uuid();
        String bearer = "Bearer " + jwtService.issueAccessToken(fx.user());
        mvc.perform(get(preview + "?page=2").header(HttpHeaders.AUTHORIZATION, bearer))
                .andExpect(status().isOk())
                .andExpect(header().string("X-SF-Total-Pages", "2"))
                .andExpect(header().string("X-SF-Page", "2"));
        mvc.perform(get(preview + "?page=99").header(HttpHeaders.AUTHORIZATION, bearer))
                .andExpect(header().string("X-SF-Page", "2"));
        mvc.perform(get(preview).header(HttpHeaders.AUTHORIZATION, bearer))
                .andExpect(header().string("X-SF-Page", "1"));

        // The editor's "N items → M pages" hint counts the source; a source of the wrong kind is not found.
        String count = "/api/v1/projects/" + fx.project().getKey() + "/pagination/count";
        mvc.perform(get(count).param("kind", "DATASET").param("source", team.uuid().toString())
                        .header(HttpHeaders.AUTHORIZATION, bearer))
                .andExpect(status().isOk())
                .andExpect(org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath("$.itemCount").value(3))
                .andExpect(org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath("$.skipped").value(0));
        mvc.perform(get(count).param("kind", "NAV").param("source", team.uuid().toString())
                        .header(HttpHeaders.AUTHORIZATION, bearer))
                .andExpect(status().isNotFound());
        mvc.perform(get(count).param("kind", "FEED").param("source", team.uuid().toString())
                        .header(HttpHeaders.AUTHORIZATION, bearer))
                .andExpect(status().isUnprocessableEntity());

        long baseline = head(fx);
        recordService.create(new CreateRecordCommand(fx.project().getId(), members,
                mapper.createObjectNode().put("name", "Dee")), fx.ctx());
        assertThat(plannedEntries(fx, baseline, page.uuid())).extracting(PlanEntry::pageNumber).containsExactlyInAnyOrder(1, 2);
    }

    // ------------------------------------------------------------------
    // Helpers
    // ------------------------------------------------------------------

    private AssetVersionView savePagination(Fixture fx, AssetVersionView page, UUID source, String kind, int pageSize, String sortKey) {
        AssetVersionView current = assetService.requireCurrent(fx.project().getId(), page.uuid());
        ObjectNode payload = current.payload().deepCopy();
        ObjectNode content = payload.withObject("content");
        content.put("intro", "Hello");
        ObjectNode value = content.putObject("posts").put("type", "PAGINATION");
        value.putObject("source").put("kind", kind).put("uuid", source.toString());
        value.put("pageSize", pageSize);
        value.putObject("sort").put("key", sortKey).put("direction", "ASC");
        return pageService.update(page.uuid(), payload, current.validFromRevision(), fx.ctx());
    }

    /** Every {@code href} of every generated HTML file that doesn't resolve, against its own page, to a generated file. */
    private static List<String> brokenLinks(Path build) throws IOException {
        List<String> broken = new ArrayList<>();
        Pattern href = Pattern.compile("href=\"([^\"#?]*)\"");
        try (Stream<Path> files = Files.walk(build)) {
            for (Path file : files.filter(f -> f.toString().endsWith(".html")).toList()) {
                Matcher matcher = href.matcher(Files.readString(file));
                while (matcher.find()) {
                    String link = matcher.group(1);
                    if (link.isEmpty() || link.contains(":")) {
                        continue;
                    }
                    Path resolved = file.getParent().resolve(link).normalize();
                    if (link.endsWith("/")) {
                        resolved = resolved.resolve("index.html");
                    }
                    if (!resolved.startsWith(build) || !Files.isRegularFile(resolved)) {
                        broken.add(build.relativize(file) + " -> " + link);
                    }
                }
            }
        }
        return broken;
    }

    private static List<String> itemLabels(String html) {
        Matcher matcher = Pattern.compile("<a class=\"item\" href=\"[^\"]*\">([^<]*)</a>").matcher(html);
        List<String> labels = new ArrayList<>();
        while (matcher.find()) {
            labels.add(matcher.group(1));
        }
        return labels;
    }

    private List<String> diagnosticCodes(SfException e) {
        Object diagnostics = e.getProblem().getExtensions().get("diagnostics");
        return mapper.valueToTree(diagnostics).findValuesAsText("code");
    }

    private Set<UUID> plannedPages(Fixture fx, long lastSuccessfulRevision) {
        return new java.util.HashSet<>(plan(fx, lastSuccessfulRevision).entries().stream().map(PlanEntry::pageUuid).toList());
    }

    private List<PlanEntry> plannedEntries(Fixture fx, long lastSuccessfulRevision, UUID page) {
        return plan(fx, lastSuccessfulRevision).entries().stream().filter(entry -> entry.pageUuid().equals(page)).toList();
    }

    private BuildPlan plan(Fixture fx, long lastSuccessfulRevision) {
        Snapshot snapshot = releasedSnapshot(fx.project().getId());
        return buildPlanner.plan(snapshot, GenerationMode.INCREMENTAL, lastSuccessfulRevision, Set.of("html"), null, null,
                OutputPathResolver.forSnapshot(snapshot, Map.of()));
    }

    private long head(Fixture fx) {
        return releasedSnapshot(fx.project().getId()).revision();
    }

    private long runToSuccess(Fixture fx, GenerationTarget target, GenerationMode mode) throws InterruptedException {
        GenerationRun finished = run(fx, target, mode);
        assertThat(finished.getStatus()).as("run diagnostics: %s", finished.getDiagnostics()).isEqualTo(RunStatus.SUCCESS);
        return finished.getId();
    }

    private GenerationRun run(Fixture fx, GenerationTarget target, GenerationMode mode) throws InterruptedException {
        releaseFixtures.releaseAll(fx.project().getKey());
        GenerationRun run = generationService.start(
                fx.project().getKey(),
                new GenerationRequest(mode, null, List.of("html"), target.getId(), null, null, null, null),
                fx.user().getId());
        long deadline = System.currentTimeMillis() + 60_000;
        while (System.currentTimeMillis() < deadline) {
            GenerationRun current = generationService.status(fx.project().getKey(), run.getId());
            RunStatus status = current.getStatus();
            if (status == RunStatus.SUCCESS || status == RunStatus.PARTIAL || status == RunStatus.FAILED
                    || status == RunStatus.CANCELLED) {
                return current;
            }
            Thread.sleep(100);
        }
        throw new AssertionError("Generation did not reach a terminal state within 60s");
    }

    private Path buildDir(Fixture fx, GenerationTarget target, long runId) {
        return TargetLocations.resolve(outputRoot, fx.project().getKey(), target).resolve("builds").resolve(String.valueOf(runId));
    }

    private GenerationTarget createTarget(Fixture fx) throws IOException {
        return targetRepository.save(new GenerationTarget(
                fx.project().getId(), "default", TargetType.FILESYSTEM, mapper.readTree("{\"baseUrl\":\"https://example.com\"}"), true));
    }

    private TemplateView pageTemplate(Fixture fx, String name, String cdl, String html) {
        return pageTemplate(fx, name, cdl, html, Map.of());
    }

    private TemplateView pageTemplate(Fixture fx, String name, String cdl, String html, Map<String, String> outputPath) {
        return templateService.create(
                new CreateTemplateCommand(fx.project().getId(), AssetType.PAGE_TEMPLATE, name + " " + SEQ.incrementAndGet(), cdl,
                        Map.of("html", html), null, false, outputPath),
                fx.ctx());
    }

    private Fixture newFixture() {
        int n = SEQ.incrementAndGet();
        AppUser user = userService.create("m21-user-" + n, "m21-user-" + n + "@example.com", "M21 User " + n, "secret-password");
        Project project = projectService.create(new CreateProjectRequest("m21p_" + n, "M21 Project " + n, null, null), user.getId());
        return new Fixture(project, user);
    }

    private record Fixture(Project project, AppUser user) {
        RevisionContext ctx() {
            return RevisionContext.of(project().getId(), user().getId(), "test");
        }
    }

    /** The released snapshot at head, after releasing everything pending (M27.2.1): what a build started now renders. */
    private Snapshot releasedSnapshot(long projectId) {
        releaseFixtures.releaseAll(projectId);
        return snapshotService.snapshot(projectId, null, SnapshotView.RELEASED);
    }
}
