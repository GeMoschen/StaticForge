package com.acme.staticforge;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.acme.staticforge.asset.Asset;
import com.acme.staticforge.asset.AssetRepository;
import com.acme.staticforge.asset.AssetService;
import com.acme.staticforge.asset.AssetType;
import com.acme.staticforge.asset.AssetVersion;
import com.acme.staticforge.asset.AssetVersionRepository;
import com.acme.staticforge.asset.AssetVersionView;
import com.acme.staticforge.asset.ReferenceKind;
import com.acme.staticforge.asset.UsageView;
import com.acme.staticforge.asset.folder.FolderNode;
import com.acme.staticforge.asset.folder.FolderScope;
import com.acme.staticforge.asset.folder.FolderService;
import com.acme.staticforge.asset.folder.StartPage;
import com.acme.staticforge.asset.page.CreatePageCommand;
import com.acme.staticforge.asset.page.PageService;
import com.acme.staticforge.asset.template.CreateTemplateCommand;
import com.acme.staticforge.asset.template.TemplateService;
import com.acme.staticforge.asset.template.TemplateView;
import com.acme.staticforge.channel.ChannelService;
import com.acme.staticforge.channel.OutputChannel;
import com.acme.staticforge.channel.UpdateChannelRequest;
import com.acme.staticforge.common.SfException;
import com.acme.staticforge.project.CreateProjectRequest;
import com.acme.staticforge.project.Project;
import com.acme.staticforge.project.ProjectRole;
import com.acme.staticforge.project.ProjectService;
import com.acme.staticforge.release.ReleaseItem;
import com.acme.staticforge.release.ReleasePlan;
import com.acme.staticforge.release.ReleaseService;
import com.acme.staticforge.revision.RevisionContext;
import com.acme.staticforge.security.JwtService;
import com.acme.staticforge.user.AppUser;
import com.acme.staticforge.user.AppUserRepository;
import com.acme.staticforge.user.SystemRole;
import com.acme.staticforge.user.UserService;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

/**
 * A pages folder's start page (M31.1): {@code PATCH /folders/{uuid}} with {@code If-Match}, validation (the folder's own
 * live page, pages folders only, {@code pages_root} allowed, the hidden root refused, the index claim conflict
 * {@code SF-DOM-0111}), roles and archived projects, {@code FolderView.startPageUuid}, the {@code START_PAGE} reference
 * edge (usages, release closure) and the delete guard that ignores it.
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class FolderStartPageApiIntegrationTest {

    private static final AtomicInteger SEQ = new AtomicInteger();
    private static final String CDL = "content { editor text title { label \"Title\" } }";
    private static final String FOLDER = "/api/v1/projects/{key}/folders/{uuid}";

    @Autowired MockMvc mvc;
    @Autowired JwtService jwt;
    @Autowired UserService users;
    @Autowired AppUserRepository appUsers;
    @Autowired ProjectService projects;
    @Autowired AssetService assets;
    @Autowired AssetRepository assetRepository;
    @Autowired AssetVersionRepository versionRepository;
    @Autowired FolderService folders;
    @Autowired PageService pages;
    @Autowired TemplateService templates;
    @Autowired ChannelService channels;
    @Autowired ReleaseService releases;
    @Autowired ObjectMapper mapper;

    private record Fixture(Project project, AppUser admin, RevisionContext ctx, TemplateView template, UUID pagesRoot) {
        long id() {
            return project.getId();
        }

        String key() {
            return project.getKey();
        }
    }

    @Test
    @DisplayName("an editor sets a subfolder's start page, reads it back in the tree and the response, and clears it with null")
    void setReadAndClear() throws Exception {
        Fixture fx = fixture("sp-set");
        String editor = member(fx, ProjectRole.EDITOR);
        AssetVersionView products = folders.create(null, "Products", FolderScope.PAGES, fx.ctx());
        UUID overview = page(fx, "Overview", products.uuid());
        page(fx, "Hammer", products.uuid());

        MvcResult set = patchStartPage(fx, editor, products.uuid(), rev(products.uuid(), fx), overview)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.uuid").value(products.uuid().toString()))
                .andExpect(jsonPath("$.startPageUuid").value(overview.toString()))
                .andReturn();
        long revision = json(set).path("revision").asLong();
        assertThat(set.getResponse().getHeader("ETag")).isEqualTo("\"rev-" + revision + "\"");
        assertThat(revision).isGreaterThan(products.validFromRevision());

        JsonNode tree = json(perform(get("/api/v1/projects/{key}/folders", fx.key()).param("scope", "PAGES"), editor)
                .andExpect(status().isOk()).andReturn());
        assertThat(tree.get(0).path("startPageUuid").isNull()).isTrue();
        assertThat(tree.get(0).path("children").get(0).path("startPageUuid").asText()).isEqualTo(overview.toString());
        List<FolderNode> nodes = folders.tree(fx.id(), FolderScope.PAGES, -1, fx.ctx());
        assertThat(nodes.get(0).children().get(0).startPage()).isEqualTo(overview);

        // History: the earlier version keeps its payload without a start page.
        Asset folderAsset = assetRepository.findByProjectIdAndUuid(fx.id(), products.uuid()).orElseThrow();
        AssetVersion before = versionRepository.findValidAtRevision(folderAsset.getId(), products.validFromRevision()).orElseThrow();
        assertThat(StartPage.fromPayload(before.getPayload())).isNull();

        patchStartPage(fx, editor, products.uuid(), revision, null)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.startPageUuid").value((Object) null));
        assertThat(StartPage.fromPayload(assets.requireCurrent(fx.id(), products.uuid()).payload())).isNull();
    }

    @Test
    @DisplayName("an unchanged value and a body without startPage write nothing; the revision is still checked")
    void unchangedWritesNothing() throws Exception {
        Fixture fx = fixture("sp-noop");
        String editor = member(fx, ProjectRole.EDITOR);
        UUID home = page(fx, "Homepage", null);
        long revision = json(patchStartPage(fx, editor, fx.pagesRoot(), rev(fx.pagesRoot(), fx), home)
                .andExpect(status().isOk()).andReturn()).path("revision").asLong();

        patchStartPage(fx, editor, fx.pagesRoot(), revision, home)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.revision").value(revision));
        perform(patch(FOLDER, fx.key(), fx.pagesRoot()).header("If-Match", etag(revision))
                .contentType(MediaType.APPLICATION_JSON).content("{}"), editor)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.revision").value(revision))
                .andExpect(jsonPath("$.startPageUuid").value(home.toString()));
        expectCode(patchStartPage(fx, editor, fx.pagesRoot(), revision - 1, home), 409, "SF-API-0409");
    }

    @Test
    @DisplayName("roles: viewers get 403, strangers 404; If-Match is required and must be current")
    void rolesAndIfMatch() throws Exception {
        Fixture fx = fixture("sp-role");
        UUID home = page(fx, "Homepage", null);
        long revision = rev(fx.pagesRoot(), fx);

        expectCode(patchStartPage(fx, member(fx, ProjectRole.VIEWER), fx.pagesRoot(), revision, home), 403, "SF-API-0403");
        patchStartPage(fx, stranger(), fx.pagesRoot(), revision, home).andExpect(status().isNotFound());
        String editor = member(fx, ProjectRole.EDITOR);
        expectCode(perform(patch(FOLDER, fx.key(), fx.pagesRoot()).contentType(MediaType.APPLICATION_JSON)
                .content(body(home)), editor), 412, "SF-API-0412");
        expectCode(patchStartPage(fx, editor, fx.pagesRoot(), revision - 1, home), 409, "SF-API-0409");
        assertThat(StartPage.fromPayload(assets.requireCurrent(fx.id(), fx.pagesRoot()).payload())).isNull();

        patchStartPage(fx, editor, fx.pagesRoot(), revision, home).andExpect(status().isOk());
    }

    @Test
    @DisplayName("archived projects refuse a start page change with 409 SF-DOM-0141")
    void archivedProject() throws Exception {
        Fixture fx = fixture("sp-arch");
        UUID home = page(fx, "Homepage", null);
        long revision = rev(fx.pagesRoot(), fx);
        projects.archive(fx.key(), fx.ctx());
        AppUser instanceAdmin = users.create("spadm" + SEQ.incrementAndGet(), "spadm" + SEQ.get() + "@example.com", "Admin",
                "secret-password");
        instanceAdmin.setSystemRole(SystemRole.INSTANCE_ADMIN);
        String admin = jwt.issueAccessToken(appUsers.save(instanceAdmin));

        expectCode(patchStartPage(fx, admin, fx.pagesRoot(), revision, home), 409, "SF-DOM-0141");
        assertThat(StartPage.fromPayload(assets.requireCurrent(fx.id(), fx.pagesRoot()).payload())).isNull();
    }

    @Test
    @DisplayName("refused: a page of another folder, a non-page asset, an unknown uuid, a deleted page, "
            + "a non-pages folder and the hidden root; pages_root is allowed")
    void validation() throws Exception {
        Fixture fx = fixture("sp-val");
        String editor = member(fx, ProjectRole.EDITOR);
        AssetVersionView products = folders.create(null, "Products", FolderScope.PAGES, fx.ctx());
        UUID loose = page(fx, "Loose", null);
        UUID gone = page(fx, "Gone", products.uuid());
        assets.softDelete(gone, true, fx.ctx());
        long revision = rev(products.uuid(), fx);

        expectCode(patchStartPage(fx, editor, products.uuid(), revision, loose), 422, "SF-API-0422");
        expectCode(patchStartPage(fx, editor, products.uuid(), revision, fx.template().uuid()), 422, "SF-API-0422");
        expectCode(patchStartPage(fx, editor, products.uuid(), revision, UUID.randomUUID()), 422, "SF-API-0422");
        expectCode(patchStartPage(fx, editor, products.uuid(), revision, gone), 422, "SF-API-0422");

        AssetVersionView media = folders.create(null, "Pictures", FolderScope.MEDIA, fx.ctx());
        expectCode(patchStartPage(fx, editor, media.uuid(), rev(media.uuid(), fx), null), 422, "SF-API-0422");
        UUID hiddenRoot = assets.ensureRootFolder(fx.id(), fx.ctx()).uuid();
        expectCode(patchStartPage(fx, editor, hiddenRoot, rev(hiddenRoot, fx), loose), 422, "SF-API-0422");
        expectCode(patchStartPage(fx, editor, UUID.randomUUID(), revision, loose), 404, "SF-API-0404");

        // pages_root is protected but may name the site's home page.
        patchStartPage(fx, editor, fx.pagesRoot(), rev(fx.pagesRoot(), fx), loose)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.protectedFolder").value(true))
                .andExpect(jsonPath("$.startPageUuid").value(loose.toString()));
    }

    @Test
    @DisplayName("a page whose UID is the index file stem refuses another start page with 409 SF-DOM-0111; "
            + "it may be the start page itself, and an indexUid page is no conflict")
    void indexClaimConflict() throws Exception {
        Fixture fx = fixture("sp-claim");
        String editor = member(fx, ProjectRole.EDITOR);
        // "index" is a reserved UID, so the channel names another index file whose stem a page can have.
        updateHtmlSettings(fx, mapper.createObjectNode().put("indexUid", "home").put("indexFileName", "start.html"));
        page(fx, "Home", null);
        UUID claimer = page(fx, "Start", null);
        UUID homepage = page(fx, "Homepage", null);

        MvcResult refused = expectCode(patchStartPage(fx, editor, fx.pagesRoot(), rev(fx.pagesRoot(), fx), homepage),
                409, "SF-DOM-0111")
                .andExpect(jsonPath("$.conflictingPageUuid").value(claimer.toString()))
                .andExpect(jsonPath("$.conflictingPageUid").value("start"))
                .andReturn();
        assertThat(json(refused).path("detail").asText()).contains("'start'");

        // The claiming page itself may be the start page; the indexUid page "home" is no conflict.
        long revision = json(patchStartPage(fx, editor, fx.pagesRoot(), rev(fx.pagesRoot(), fx), claimer)
                .andExpect(status().isOk()).andReturn()).path("revision").asLong();
        assets.softDelete(claimer, true, fx.ctx());
        patchStartPage(fx, editor, fx.pagesRoot(), revision, homepage)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.startPageUuid").value(homepage.toString()));
    }

    @Test
    @DisplayName("the START_PAGE edge: usages list the folder, releasing the folder proposes its unreleased start page, "
            + "and it never blocks deleting the page")
    void referenceEdge() throws Exception {
        Fixture fx = fixture("sp-edge");
        AssetVersionView products = folders.create(null, "Products", FolderScope.PAGES, fx.ctx());
        UUID overview = page(fx, "Overview", products.uuid());
        folders.updateStartPage(products.uuid(), overview, rev(products.uuid(), fx), fx.ctx());

        List<UsageView> usages = assets.usages(fx.id(), overview);
        assertThat(usages).anySatisfy(usage -> {
            assertThat(usage.fromUuid()).isEqualTo(products.uuid());
            assertThat(usage.kind()).isEqualTo(ReferenceKind.START_PAGE);
            assertThat(usage.sourcePath()).isEqualTo(StartPage.PAYLOAD_KEY);
        });

        ReleasePlan plan = releases.plan(fx.id(), List.of(ReleaseItem.of(products.uuid())));
        assertThat(plan.dependencies()).anySatisfy(dependency -> {
            assertThat(dependency.target().assetUuid()).isEqualTo(overview);
            assertThat(dependency.reason()).isEqualTo(ReleasePlan.Reason.REFERENCE);
            assertThat(dependency.via()).isEqualTo(products.uuid());
            assertThat(dependency.includedByDefault()).isTrue();
        });

        // Deleting the start page needs no force: the folder falls back to the indexUid rule.
        assets.softDelete(overview, false, fx.ctx());
        assertThat(assets.requireCurrent(fx.id(), overview).deleted()).isTrue();
        // A deleted page can't become the start page again.
        assertThatThrownBy(() -> folders.updateStartPage(
                        products.uuid(), overview, rev(products.uuid(), fx), fx.ctx()))
                .isInstanceOf(SfException.class);
    }

    @Test
    @DisplayName("a pages_root start page is a live edge too: usages list pages_root")
    void pagesRootEdge() {
        Fixture fx = fixture("sp-rootedge");
        UUID home = page(fx, "Homepage", null);
        folders.updateStartPage(fx.pagesRoot(), home, rev(fx.pagesRoot(), fx), fx.ctx());
        assertThat(assets.usages(fx.id(), home))
                .extracting(UsageView::fromUuid, UsageView::kind)
                .containsExactly(org.assertj.core.groups.Tuple.tuple(fx.pagesRoot(), ReferenceKind.START_PAGE));

        folders.updateStartPage(fx.pagesRoot(), null, rev(fx.pagesRoot(), fx), fx.ctx());
        assertThat(assets.usages(fx.id(), home)).isEmpty();
    }

    // ------------------------------------------------------------------
    // Fixtures
    // ------------------------------------------------------------------

    private Fixture fixture(String prefix) {
        int n = SEQ.incrementAndGet();
        AppUser admin = users.create(prefix + n, prefix + n + "@example.com", "Admin", "secret-password");
        Project project = projects.create(
                new CreateProjectRequest(prefix.replace("-", "") + n, prefix + n, null, "start pages"), admin.getId());
        RevisionContext ctx = RevisionContext.of(project.getId(), admin.getId(), "start pages");
        TemplateView template = templates.create(new CreateTemplateCommand(project.getId(), AssetType.PAGE_TEMPLATE, "Page", CDL,
                Map.of("html", "<h1>$CMS_VALUE(title)$</h1>"), null, false, Map.of()), ctx);
        UUID pagesRoot = folders.tree(project.getId(), FolderScope.PAGES, 0, ctx).get(0).uuid();
        return new Fixture(project, admin, ctx, template, pagesRoot);
    }

    private UUID page(Fixture fx, String name, UUID folder) {
        return pages.create(new CreatePageCommand(name, folder, fx.template().uuid()), fx.ctx()).uuid();
    }

    private long rev(UUID asset, Fixture fx) {
        return assets.requireCurrent(fx.id(), asset).validFromRevision();
    }

    private void updateHtmlSettings(Fixture fx, JsonNode settings) {
        OutputChannel html = channels.list(fx.id()).stream().filter(c -> c.getKey().equals("html")).findFirst().orElseThrow();
        channels.update("html", new UpdateChannelRequest(html.getName(), html.getFileExtension(), html.getMimeType(),
                html.getDefaultEscaping(), html.isEnabled(), html.isDefaultChannel(), html.getPosition(), settings), fx.ctx());
    }

    private String member(Fixture fx, ProjectRole role) {
        int n = SEQ.incrementAndGet();
        AppUser user = users.create("sp" + n + role.name().toLowerCase(), "sp" + n + "@example.com", "Member", "secret-password");
        projects.setMemberRole(fx.key(), user.getId(), role, fx.ctx());
        return jwt.issueAccessToken(users.findById(user.getId()).orElseThrow());
    }

    private String stranger() {
        int n = SEQ.incrementAndGet();
        AppUser user = users.create("spx" + n, "spx" + n + "@example.com", "Stranger", "secret-password");
        return jwt.issueAccessToken(user);
    }

    private static String body(UUID startPage) {
        return startPage == null ? "{\"startPage\":null}" : "{\"startPage\":\"" + startPage + "\"}";
    }

    private static String etag(long revision) {
        return "\"rev-" + revision + "\"";
    }

    private ResultActions patchStartPage(Fixture fx, String token, UUID folder, long revision, UUID startPage)
            throws Exception {
        return perform(patch(FOLDER, fx.key(), folder).header("If-Match", etag(revision))
                .contentType(MediaType.APPLICATION_JSON).content(body(startPage)), token);
    }

    private ResultActions perform(MockHttpServletRequestBuilder request, String token) throws Exception {
        return mvc.perform(request.header("Authorization", "Bearer " + token));
    }

    private static ResultActions expectCode(ResultActions result, int status, String code) throws Exception {
        return result.andExpect(status().is(status)).andExpect(jsonPath("$.code").value(code));
    }

    private JsonNode json(MvcResult result) throws Exception {
        return mapper.readTree(result.getResponse().getContentAsString(StandardCharsets.UTF_8));
    }
}
