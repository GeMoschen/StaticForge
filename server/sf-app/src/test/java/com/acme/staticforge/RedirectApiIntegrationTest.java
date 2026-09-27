package com.acme.staticforge;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.contains;
import static org.hamcrest.Matchers.containsInAnyOrder;
import static org.hamcrest.Matchers.hasSize;
import static org.hamcrest.Matchers.nullValue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.acme.staticforge.asset.AssetService;
import com.acme.staticforge.asset.AssetType;
import com.acme.staticforge.asset.AssetVersionView;
import com.acme.staticforge.asset.page.CreatePageCommand;
import com.acme.staticforge.asset.page.PageService;
import com.acme.staticforge.asset.template.CreateTemplateCommand;
import com.acme.staticforge.asset.template.TemplateService;
import com.acme.staticforge.asset.template.TemplateView;
import com.acme.staticforge.audit.AuditLog;
import com.acme.staticforge.audit.AuditService;
import com.acme.staticforge.generate.GenerationTarget;
import com.acme.staticforge.generate.GenerationTargetRepository;
import com.acme.staticforge.generate.TargetType;
import com.acme.staticforge.generate.pipeline.OutputFile;
import com.acme.staticforge.generate.target.BuildManifest;
import com.acme.staticforge.generate.target.TargetWriter;
import com.acme.staticforge.generate.target.TargetWriterSelector;
import com.acme.staticforge.project.CreateProjectRequest;
import com.acme.staticforge.project.LocaleConfig;
import com.acme.staticforge.project.Project;
import com.acme.staticforge.project.ProjectLocale;
import com.acme.staticforge.project.ProjectRole;
import com.acme.staticforge.project.ProjectService;
import com.acme.staticforge.project.publish.PublishPermission;
import com.acme.staticforge.project.publish.PublishPolicy;
import com.acme.staticforge.redirect.RedirectEntry;
import com.acme.staticforge.redirect.RedirectKind;
import com.acme.staticforge.redirect.RedirectRepository;
import com.acme.staticforge.redirect.RedirectService;
import com.acme.staticforge.redirect.RedirectService.AutoCandidate;
import com.acme.staticforge.redirect.RedirectService.AutoResult;
import com.acme.staticforge.revision.RevisionContext;
import com.acme.staticforge.security.JwtService;
import com.acme.staticforge.user.AppUser;
import com.acme.staticforge.user.AppUserRepository;
import com.acme.staticforge.user.SystemRole;
import com.acme.staticforge.user.UserService;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicLong;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.data.domain.PageRequest;
import org.springframework.http.MediaType;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

/**
 * The redirect registry API (M30.4.1): manual CRUD with validation ({@code SF-DOM-0190}–{@code 0194}), {@code If-Match},
 * roles, archived projects, audit, {@code for-asset}, the state of each row against the default target's current
 * build, and the {@code upsertAuto} seam of detection (M30.4.2). Builds are published synthetically — a manifest and
 * files through the target's writer — so the tests control every output path.
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class RedirectApiIntegrationTest {

    private static final AtomicInteger SEQ = new AtomicInteger();
    /** Synthetic build ids, far away from real runs. */
    private static final AtomicLong RUN = new AtomicLong(7_000_000L);
    private static final String CDL = "content { editor text title { label \"Title\" } }";
    private static final String BASE = "/api/v1/projects/{key}/redirects";

    @Autowired MockMvc mvc;
    @Autowired JwtService jwt;
    @Autowired UserService users;
    @Autowired AppUserRepository appUsers;
    @Autowired ProjectService projects;
    @Autowired AssetService assets;
    @Autowired PageService pages;
    @Autowired TemplateService templates;
    @Autowired GenerationTargetRepository targets;
    @Autowired TargetWriterSelector writers;
    @Autowired RedirectService redirects;
    @Autowired RedirectRepository redirectRepository;
    @Autowired AuditService audit;
    @Autowired ObjectMapper mapper;

    private record Fixture(Project project, AppUser admin, RevisionContext ctx, TemplateView template, GenerationTarget target) {
        long id() {
            return project.getId();
        }

        String key() {
            return project.getKey();
        }
    }

    // ------------------------------------------------------------------
    // CRUD, roles, validation
    // ------------------------------------------------------------------

    @Test
    @DisplayName("viewers read; editors can't write, not even with RELEASE; developers create, edit and delete; strangers get 404")
    void roles() throws Exception {
        Fixture fx = fixture("rdr-role", false);
        String viewer = member(fx, ProjectRole.VIEWER);
        String editor = member(fx, ProjectRole.EDITOR);
        String developer = member(fx, ProjectRole.DEVELOPER);
        String stranger = stranger();
        String body = pathBody("html", "", "old.html", "new.html");

        create(fx, viewer, body).andExpect(status().isForbidden());
        create(fx, editor, body).andExpect(status().isForbidden());
        create(fx, stranger, body).andExpect(status().isNotFound());
        MvcResult created = create(fx, developer, body).andExpect(status().isOk())
                .andExpect(header().string("ETag", "\"v0\""))
                .andExpect(jsonPath("$.kind").value("MANUAL"))
                .andExpect(jsonPath("$.fromPath").value("old.html"))
                .andExpect(jsonPath("$.toPath").value("new.html"))
                .andReturn();
        long id = json(created).path("id").asLong();

        perform(get(BASE, fx.key()), viewer).andExpect(status().isOk()).andExpect(jsonPath("$.rows", hasSize(1)));
        perform(get(BASE + "/{id}", fx.key(), id), viewer).andExpect(status().isOk());
        perform(get(BASE, fx.key()), stranger).andExpect(status().isNotFound());
        perform(put(BASE + "/{id}", fx.key(), id).header("If-Match", "\"v0\"")
                .contentType(MediaType.APPLICATION_JSON).content(body), editor).andExpect(status().isForbidden());
        perform(delete(BASE + "/{id}", fx.key(), id), viewer).andExpect(status().isForbidden());

        // An editor under a policy with RELEASE may redirect a page's URLs (for-asset), but still not edit the registry.
        UUID page = page(fx, "home");
        UUID target = page(fx, "target");
        publish(fx, pageOutput("home.html", page, "html", null, null));
        String forAsset = "{\"assetUuid\":\"" + page + "\",\"toAssetUuid\":\"" + target + "\"}";
        expectCode(perform(post(BASE + "/for-asset", fx.key()).contentType(MediaType.APPLICATION_JSON).content(forAsset), editor),
                403, "SF-API-0403");
        perform(post(BASE + "/for-asset", fx.key()).contentType(MediaType.APPLICATION_JSON).content(forAsset), viewer)
                .andExpect(status().isForbidden());
        projects.updatePublishPolicy(fx.key(), new PublishPolicy(Set.of(PublishPermission.RELEASE)), fx.ctx());
        perform(post(BASE + "/for-asset", fx.key()).contentType(MediaType.APPLICATION_JSON).content(forAsset), editor)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$", hasSize(1)))
                .andExpect(jsonPath("$[0].fromPath").value("home.html"));
        create(fx, editor, pathBody("html", "", "other.html", "new.html")).andExpect(status().isForbidden());
        perform(delete(BASE + "/{id}", fx.key(), id), editor).andExpect(status().isForbidden());

        perform(delete(BASE + "/{id}", fx.key(), id), developer).andExpect(status().isNoContent());
        expectCode(perform(get(BASE + "/{id}", fx.key(), id), developer), 404, "SF-DOM-0190");
    }

    @Test
    @DisplayName("validation: SF-DOM-0190, 0191, 0192, 0193; paths are normalized")
    void validation() throws Exception {
        Fixture fx = fixture("rdr-val", false);
        String dev = member(fx, ProjectRole.DEVELOPER);
        UUID page = page(fx, "page");
        UUID removed = page(fx, "removed");
        assets.softDelete(removed, true, fx.ctx());

        // Normalized: leading slash dropped, a directory means its index file, percent-decoding.
        create(fx, dev, pathBody("html", null, "/old/", "/new/%C3%BCber.html#top")).andExpect(status().isOk())
                .andExpect(jsonPath("$.fromPath").value("old/index.html"))
                .andExpect(jsonPath("$.toPath").value("new/über.html#top"))
                .andExpect(jsonPath("$.locale").value(""));
        expectCode(create(fx, dev, pathBody("html", "", "old/index.html", "elsewhere.html")), 409, "SF-DOM-0191");

        expectCode(create(fx, dev, pathBody("html", "", "a.html", "a.html#x")), 422, "SF-DOM-0192");
        create(fx, dev, pathBody("html", "", "b.html", "c.html")).andExpect(status().isOk());
        expectCode(create(fx, dev, pathBody("html", "", "c.html", "b.html")), 422, "SF-DOM-0192");
        // A page target that is published at the source path itself.
        publish(fx, pageOutput("page.html", page, "html", null, null));
        expectCode(create(fx, dev, assetBody("html", "", "page.html", page, null)), 422, "SF-DOM-0192");

        expectCode(create(fx, dev, pathBody("html", "", "../up.html", "x.html")), 422, "SF-DOM-0193");
        expectCode(create(fx, dev, pathBody("html", "", "https://example.com/x", "x.html")), 422, "SF-DOM-0193");
        expectCode(create(fx, dev, pathBody("html", "", "x.html", "javascript:alert(1)")), 422, "SF-DOM-0193");
        expectCode(create(fx, dev, pathBody("html", "", "x.html", "//evil.example/x")), 422, "SF-DOM-0193");
        expectCode(create(fx, dev, pathBody("nope", "", "x.html", "y.html")), 422, "SF-DOM-0193");
        expectCode(create(fx, dev, pathBody("html", "de", "x.html", "y.html")), 422, "SF-DOM-0193");
        expectCode(create(fx, dev, "{\"channel\":\"html\",\"fromPath\":\"x.html\"}"), 422, "SF-DOM-0193");
        expectCode(create(fx, dev, "{\"channel\":\"html\",\"fromPath\":\"x.html\",\"toPath\":\"y.html\",\"toAssetUuid\":\""
                + page + "\"}"), 422, "SF-DOM-0193");
        expectCode(create(fx, dev, assetBody("html", "", "x.html", removed, null)), 422, "SF-DOM-0193");
        expectCode(create(fx, dev, assetBody("html", "", "x.html", fx.template().uuid(), null)), 422, "SF-DOM-0193");
        expectCode(create(fx, dev, assetBody("html", "", "x.html", UUID.randomUUID(), null)), 422, "SF-DOM-0193");
        expectCode(create(fx, dev, assetBody("html", "", "x.html", page, 0)), 422, "SF-DOM-0193");

        expectCode(perform(get(BASE + "/{id}", fx.key(), 987_654_321L), dev), 404, "SF-DOM-0190");
        expectCode(perform(put(BASE + "/{id}", fx.key(), 987_654_321L).header("If-Match", "\"v0\"")
                .contentType(MediaType.APPLICATION_JSON).content(pathBody("html", "", "q.html", "r.html")), dev), 404, "SF-DOM-0190");
        expectCode(perform(delete(BASE + "/{id}", fx.key(), 987_654_321L), dev), 404, "SF-DOM-0190");

        // Another project's redirect is not this project's.
        Fixture other = fixture("rdr-val-o", false);
        long foreign = redirects.create(other.id(), new RedirectService.Command("html", "", "f.html", null, null, "g.html"),
                other.admin().getId()).getId();
        expectCode(perform(get(BASE + "/{id}", fx.key(), foreign), dev), 404, "SF-DOM-0190");
    }

    @Test
    @DisplayName("PUT needs If-Match with the current version: missing is 412, stale is 409 SF-API-0409; an AUTO entry becomes MANUAL")
    void optimisticLocking() throws Exception {
        Fixture fx = fixture("rdr-lock", false);
        String dev = member(fx, ProjectRole.DEVELOPER);
        UUID page = page(fx, "page");
        long id = json(create(fx, dev, pathBody("html", "", "old.html", "new.html")).andReturn()).path("id").asLong();
        String edit = assetBody("html", "", "old.html", page, 2);

        perform(put(BASE + "/{id}", fx.key(), id).contentType(MediaType.APPLICATION_JSON).content(edit), dev)
                .andExpect(status().isPreconditionFailed());
        perform(put(BASE + "/{id}", fx.key(), id).header("If-Match", "\"v0\"")
                .contentType(MediaType.APPLICATION_JSON).content(edit), dev)
                .andExpect(status().isOk())
                .andExpect(header().string("ETag", "\"v1\""))
                .andExpect(jsonPath("$.toAssetUuid").value(page.toString()))
                .andExpect(jsonPath("$.toPageNumber").value(2))
                .andExpect(jsonPath("$.toAssetName").value("page"))
                .andExpect(jsonPath("$.toPath").value(nullValue()));
        expectCode(perform(put(BASE + "/{id}", fx.key(), id).header("If-Match", "\"v0\"")
                .contentType(MediaType.APPLICATION_JSON).content(edit), dev), 409, "SF-API-0409");
        expectCode(perform(delete(BASE + "/{id}", fx.key(), id).header("If-Match", "\"v0\""), dev), 409, "SF-API-0409");

        // Moving the source onto another redirect's path is a duplicate.
        create(fx, dev, pathBody("html", "", "taken.html", "new.html")).andExpect(status().isOk());
        expectCode(perform(put(BASE + "/{id}", fx.key(), id).header("If-Match", "\"v1\"")
                .contentType(MediaType.APPLICATION_JSON).content(pathBody("html", "", "taken.html", "x.html")), dev), 409, "SF-DOM-0191");

        redirects.upsertAuto(fx.id(), 42L, List.of(new AutoCandidate("html", "", "auto.html", page, 1)));
        RedirectEntry auto = entry(fx, "auto.html");
        assertThat(auto.getKind()).isEqualTo(RedirectKind.AUTO);
        perform(put(BASE + "/{id}", fx.key(), auto.getId()).header("If-Match", "\"v" + auto.getVersion() + "\"")
                .contentType(MediaType.APPLICATION_JSON).content(pathBody("html", "", "auto.html", "fixed.html")), dev)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.kind").value("MANUAL"))
                .andExpect(jsonPath("$.sourceRunId").value(42));
        perform(delete(BASE + "/{id}", fx.key(), id).header("If-Match", "\"v1\""), dev).andExpect(status().isNoContent());
    }

    @Test
    @DisplayName("archived projects refuse every redirect change with 409 SF-DOM-0141 but can be read")
    void archivedProject() throws Exception {
        Fixture fx = fixture("rdr-arch", false);
        UUID page = page(fx, "home");
        UUID target = page(fx, "target");
        publish(fx, pageOutput("home.html", page, "html", null, null));
        long id = redirects.create(fx.id(), new RedirectService.Command("html", "", "old.html", null, null, "new.html"),
                fx.admin().getId()).getId();
        projects.archive(fx.key(), fx.ctx());
        AppUser instanceAdmin = users.create("radm" + SEQ.incrementAndGet(), "radm" + SEQ.get() + "@example.com", "Admin",
                "secret-password");
        instanceAdmin.setSystemRole(SystemRole.INSTANCE_ADMIN);
        String admin = jwt.issueAccessToken(appUsers.save(instanceAdmin));

        expectCode(create(fx, admin, pathBody("html", "", "x.html", "y.html")), 409, "SF-DOM-0141");
        expectCode(perform(put(BASE + "/{id}", fx.key(), id).header("If-Match", "\"v0\"")
                .contentType(MediaType.APPLICATION_JSON).content(pathBody("html", "", "old.html", "z.html")), admin), 409, "SF-DOM-0141");
        expectCode(perform(delete(BASE + "/{id}", fx.key(), id), admin), 409, "SF-DOM-0141");
        expectCode(perform(post(BASE + "/for-asset", fx.key()).contentType(MediaType.APPLICATION_JSON)
                .content("{\"assetUuid\":\"" + page + "\",\"toAssetUuid\":\"" + target + "\"}"), admin), 409, "SF-DOM-0141");
        perform(get(BASE, fx.key()), admin).andExpect(status().isOk()).andExpect(jsonPath("$.rows", hasSize(1)));
        assertThat(redirectRepository.findById(id)).get().extracting(RedirectEntry::getToPath).isEqualTo("new.html");
    }

    @Test
    @DisplayName("manual changes are audited with the redirect as target; automatic ones are not")
    void audit() throws Exception {
        Fixture fx = fixture("rdr-audit", false);
        String dev = member(fx, ProjectRole.DEVELOPER);
        UUID page = page(fx, "page");
        long id = json(create(fx, dev, pathBody("html", "", "old.html", "new.html")).andReturn()).path("id").asLong();
        perform(put(BASE + "/{id}", fx.key(), id).header("If-Match", "\"v0\"")
                .contentType(MediaType.APPLICATION_JSON).content(pathBody("html", "", "old.html", "newer.html")), dev)
                .andExpect(status().isOk());
        perform(delete(BASE + "/{id}", fx.key(), id), dev).andExpect(status().isNoContent());
        redirects.upsertAuto(fx.id(), 7L, List.of(new AutoCandidate("html", "", "auto.html", page, 1)));

        List<AuditLog> entries = audit.findRecent(fx.id(), PageRequest.of(0, 100)).stream()
                .filter(e -> e.getAction().startsWith("REDIRECT_"))
                .toList();
        assertThat(entries).extracting(AuditLog::getAction)
                .containsExactlyInAnyOrder("REDIRECT_CREATED", "REDIRECT_UPDATED", "REDIRECT_DELETED");
        assertThat(entries).extracting(AuditLog::getTarget).containsOnly("redirect:html//old.html");
        AuditLog updated = entries.stream().filter(e -> e.getAction().equals("REDIRECT_UPDATED")).findFirst().orElseThrow();
        assertThat(updated.getDetail().path("before").path("toPath").asText()).isEqualTo("new.html");
        assertThat(updated.getDetail().path("toPath").asText()).isEqualTo("newer.html");
    }

    // ------------------------------------------------------------------
    // State, listing
    // ------------------------------------------------------------------

    @Test
    @DisplayName("each row's state against the default target's current build: active, shadowed, dangling, loop; none without a build")
    void states() throws Exception {
        Fixture fx = fixture("rdr-state", false);
        String viewer = member(fx, ProjectRole.VIEWER);
        UUID moved = page(fx, "moved");
        UUID unpublished = page(fx, "unpublished");
        UUID squatter = page(fx, "squatter");
        long active = redirects.create(fx.id(), new RedirectService.Command("html", "", "old/moved.html", moved, null, null),
                fx.admin().getId()).getId();
        long shadowed = redirects.create(fx.id(), new RedirectService.Command("html", "", "taken.html", moved, null, null),
                fx.admin().getId()).getId();
        long dangling = redirects.create(fx.id(), new RedirectService.Command("html", "", "gone.html", unpublished, null, null),
                fx.admin().getId()).getId();
        long fixed = redirects.create(fx.id(), new RedirectService.Command("html", "", "ext.html", null, null,
                "https://example.org/ext"), fx.admin().getId()).getId();

        perform(get(BASE, fx.key()), viewer).andExpect(status().isOk())
                .andExpect(jsonPath("$.basisRunId").value(nullValue()))
                .andExpect(jsonPath("$.rows[0].state").value(nullValue()))
                .andExpect(jsonPath("$.rows[0].resolvedTarget").value(nullValue()));
        // Without a build no row has a state, so a state filter matches nothing.
        perform(get(BASE, fx.key()).param("state", "ACTIVE"), viewer).andExpect(status().isOk())
                .andExpect(jsonPath("$.totalElements").value(0))
                .andExpect(jsonPath("$.rows", hasSize(0)));

        long runId = publish(fx,
                pageOutput("new/moved.html", moved, "html", null, null),
                pageOutput("taken.html", squatter, "html", null, null),
                new BuildManifest.Output("sitemap.xml", BuildManifest.Kind.SITE, null, null, null, Set.of()));
        // Moved back onto its old path by hand in the store: an AUTO entry would now lead to itself.
        redirects.upsertAuto(fx.id(), runId, List.of(new AutoCandidate("html", "", "new/moved.html", moved, 1)));
        long loop = entry(fx, "new/moved.html").getId();

        JsonNode page = json(perform(get(BASE, fx.key()), viewer).andExpect(status().isOk()).andReturn());
        assertThat(page.path("basisRunId").asLong()).isEqualTo(runId);
        assertThat(page.path("totalElements").asLong()).isEqualTo(5);
        Map<Long, JsonNode> byId = new java.util.HashMap<>();
        page.path("rows").forEach(row -> byId.put(row.path("id").asLong(), row));
        assertThat(byId.get(active).path("state").asText()).isEqualTo("ACTIVE");
        assertThat(byId.get(active).path("resolvedTarget").asText()).isEqualTo("new/moved.html");
        assertThat(byId.get(active).path("toAssetName").asText()).isEqualTo("moved");
        assertThat(byId.get(shadowed).path("state").asText()).isEqualTo("SHADOWED");
        assertThat(byId.get(dangling).path("state").asText()).isEqualTo("DANGLING");
        assertThat(byId.get(dangling).path("resolvedTarget").isNull()).isTrue();
        assertThat(byId.get(fixed).path("state").asText()).isEqualTo("ACTIVE");
        assertThat(byId.get(fixed).path("resolvedTarget").asText()).isEqualTo("https://example.org/ext");
        assertThat(byId.get(loop).path("state").asText()).isEqualTo("LOOP");
        assertThat(byId.get(loop).path("kind").asText()).isEqualTo("AUTO");
        assertThat(byId.get(loop).path("createdBy").isNull()).isTrue();
        assertThat(byId.get(loop).path("sourceRunId").asLong()).isEqualTo(runId);

        perform(get(BASE + "/{id}", fx.key(), shadowed), viewer).andExpect(jsonPath("$.state").value("SHADOWED"));

        // The state filter (computed per row, paged after filtering) and its combination with the other filters.
        perform(get(BASE, fx.key()).param("state", "active"), viewer).andExpect(status().isOk())
                .andExpect(jsonPath("$.totalElements").value(2))
                .andExpect(jsonPath("$.rows[*].id", containsInAnyOrder((int) active, (int) fixed)));
        perform(get(BASE, fx.key()).param("state", "ACTIVE").param("size", "1").param("page", "1"), viewer)
                .andExpect(jsonPath("$.totalElements").value(2))
                .andExpect(jsonPath("$.totalPages").value(2))
                .andExpect(jsonPath("$.rows", hasSize(1)))
                .andExpect(jsonPath("$.rows[0].id").value((int) active));
        perform(get(BASE, fx.key()).param("state", "ACTIVE").param("q", "ext"), viewer)
                .andExpect(jsonPath("$.totalElements").value(1))
                .andExpect(jsonPath("$.rows[0].id").value((int) fixed));
        perform(get(BASE, fx.key()).param("state", "LOOP").param("kind", "AUTO"), viewer)
                .andExpect(jsonPath("$.rows[*].id", contains((int) loop)));
        perform(get(BASE, fx.key()).param("state", "DANGLING"), viewer)
                .andExpect(jsonPath("$.rows[*].id", contains((int) dangling)));
        perform(get(BASE, fx.key()).param("state", "BROKEN"), viewer).andExpect(status().isBadRequest());

        // Unpublishing the squatter (a new build without it) makes the shadowed redirect active.
        publish(fx, pageOutput("new/moved.html", moved, "html", null, null));
        perform(get(BASE + "/{id}", fx.key(), shadowed), viewer)
                .andExpect(jsonPath("$.state").value("ACTIVE"))
                .andExpect(jsonPath("$.resolvedTarget").value("new/moved.html"));
    }

    @Test
    @DisplayName("the list filters by channel, locale, kind and path text, and pages")
    void listFilters() throws Exception {
        Fixture fx = fixture("rdr-list", true);
        String viewer = member(fx, ProjectRole.VIEWER);
        UUID page = page(fx, "page");
        long admin = fx.admin().getId();
        redirects.create(fx.id(), new RedirectService.Command("html", "de", "de/alt.html", null, null, "de/neu.html"), admin);
        redirects.create(fx.id(), new RedirectService.Command("html", "en", "en/old.html", null, null, "en/new_1.html"), admin);
        redirects.create(fx.id(), new RedirectService.Command("html", "EN", "en/older.html", page, null, null), admin);
        redirects.upsertAuto(fx.id(), 1L, List.of(new AutoCandidate("html", "de", "de/auto.html", page, 1)));

        perform(get(BASE, fx.key()), viewer)
                .andExpect(jsonPath("$.rows", hasSize(4)))
                .andExpect(jsonPath("$.rows[0].fromPath").value("de/alt.html"))
                .andExpect(jsonPath("$.rows[1].fromPath").value("de/auto.html"));
        perform(get(BASE, fx.key()).param("locale", "en"), viewer).andExpect(jsonPath("$.rows", hasSize(2)))
                .andExpect(jsonPath("$.rows[1].locale").value("en"));
        perform(get(BASE, fx.key()).param("kind", "auto"), viewer).andExpect(jsonPath("$.rows", hasSize(1)))
                .andExpect(jsonPath("$.rows[0].fromPath").value("de/auto.html"));
        perform(get(BASE, fx.key()).param("q", "NEW_"), viewer).andExpect(jsonPath("$.rows", hasSize(1)))
                .andExpect(jsonPath("$.rows[0].fromPath").value("en/old.html"));
        perform(get(BASE, fx.key()).param("q", "_"), viewer).andExpect(jsonPath("$.rows", hasSize(1)));
        perform(get(BASE, fx.key()).param("channel", "md"), viewer).andExpect(jsonPath("$.rows", hasSize(0)));
        perform(get(BASE, fx.key()).param("size", "3").param("page", "1"), viewer)
                .andExpect(jsonPath("$.rows", hasSize(1)))
                .andExpect(jsonPath("$.totalElements").value(4))
                .andExpect(jsonPath("$.totalPages").value(2));
        perform(get(BASE, fx.key()).param("kind", "SOMETIMES"), viewer).andExpect(status().isBadRequest());
        perform(get(BASE, fx.key()).param("size", "201"), viewer).andExpect(status().isBadRequest());

        // A localized project needs a declared locale.
        String dev = member(fx, ProjectRole.DEVELOPER);
        expectCode(create(fx, dev, pathBody("html", "", "x.html", "y.html")), 422, "SF-DOM-0193");
        expectCode(create(fx, dev, pathBody("html", "fr", "x.html", "y.html")), 422, "SF-DOM-0193");
    }

    // ------------------------------------------------------------------
    // for-asset
    // ------------------------------------------------------------------

    @Test
    @DisplayName("for-asset on a localized, paginated page: one MANUAL entry per channel, locale and page number, all to page 1")
    void forAssetLocalizedPaginated() throws Exception {
        Fixture fx = fixture("rdr-fa", true);
        String dev = member(fx, ProjectRole.DEVELOPER);
        UUID list = page(fx, "list");
        UUID target = page(fx, "target");
        UUID bystander = page(fx, "bystander");
        publish(fx,
                pageOutput("de/liste.html", list, "html", "de", null),
                pageOutput("de/liste-2.html", list, "html", "de", 2),
                pageOutput("en/list.html", list, "html", "en", null),
                pageOutput("en/list-2.html", list, "html", "en", 2),
                pageOutput("en/list-3.html", list, "html", "en", 3),
                pageOutput("de/ziel.html", target, "html", "de", null),
                pageOutput("en/target.html", target, "html", "en", null),
                pageOutput("de/anderes.html", bystander, "html", "de", null));
        // Existing redirects of two of those paths: a manual one (replaced) and an automatic one (overwritten).
        long manual = redirects.create(fx.id(), new RedirectService.Command("html", "de", "de/liste.html", null, null,
                "de/irgendwo.html"), fx.admin().getId()).getId();
        redirects.upsertAuto(fx.id(), 3L, List.of(new AutoCandidate("html", "en", "en/list-2.html", bystander, 1)));

        JsonNode written = json(perform(post(BASE + "/for-asset", fx.key()).contentType(MediaType.APPLICATION_JSON)
                .content("{\"assetUuid\":\"" + list + "\",\"toAssetUuid\":\"" + target + "\"}"), dev)
                .andExpect(status().isOk()).andReturn());

        assertThat(written).hasSize(5);
        List<String> rows = new ArrayList<>();
        written.forEach(row -> {
            assertThat(row.path("kind").asText()).isEqualTo("MANUAL");
            assertThat(row.path("toAssetUuid").asText()).isEqualTo(target.toString());
            assertThat(row.path("toPageNumber").asInt()).isEqualTo(1);
            // The page is still published at these paths until the next build without it.
            assertThat(row.path("state").asText()).isEqualTo("SHADOWED");
            rows.add(row.path("locale").asText() + ":" + row.path("fromPath").asText() + "->" + row.path("resolvedTarget").asText());
        });
        assertThat(rows).containsExactly(
                "de:de/liste-2.html->de/ziel.html",
                "de:de/liste.html->de/ziel.html",
                "en:en/list-2.html->en/target.html",
                "en:en/list-3.html->en/target.html",
                "en:en/list.html->en/target.html");
        assertThat(redirectRepository.findById(manual)).get().satisfies(e -> {
            assertThat(e.getToAssetUuid()).isEqualTo(target);
            assertThat(e.getToPath()).isNull();
            assertThat(e.getVersion()).isEqualTo(1);
        });
        assertThat(entry(fx, "en", "en/list-2.html")).satisfies(e -> {
            assertThat(e.getKind()).isEqualTo(RedirectKind.MANUAL);
            assertThat(e.getToAssetUuid()).isEqualTo(target);
        });
        assertThat(redirectRepository.findByProjectIdOrderByChannelKeyAscLocaleKeyAscFromPathAsc(fx.id())).hasSize(5);
        assertThat(audit.findRecent(fx.id(), PageRequest.of(0, 100)))
                .filteredOn(e -> e.getAction().startsWith("REDIRECT_") && e.getDetail().path("forAsset").isTextual())
                .extracting(AuditLog::getAction)
                .containsExactlyInAnyOrder("REDIRECT_UPDATED", "REDIRECT_UPDATED", "REDIRECT_CREATED", "REDIRECT_CREATED",
                        "REDIRECT_CREATED");

        // A fixed target per output, and the refusals.
        perform(post(BASE + "/for-asset", fx.key()).contentType(MediaType.APPLICATION_JSON)
                .content("{\"assetUuid\":\"" + bystander + "\",\"toPath\":\"/de/\"}"), dev)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$", hasSize(1)))
                .andExpect(jsonPath("$[0].toPath").value("de/index.html"));
        expectCode(perform(post(BASE + "/for-asset", fx.key()).contentType(MediaType.APPLICATION_JSON)
                .content("{\"assetUuid\":\"" + list + "\",\"toAssetUuid\":\"" + list + "\"}"), dev), 422, "SF-DOM-0192");
        expectCode(perform(post(BASE + "/for-asset", fx.key()).contentType(MediaType.APPLICATION_JSON)
                .content("{\"assetUuid\":\"" + list + "\",\"toPath\":\"en/list-3.html\"}"), dev), 422, "SF-DOM-0192");
        expectCode(perform(post(BASE + "/for-asset", fx.key()).contentType(MediaType.APPLICATION_JSON)
                .content("{\"assetUuid\":\"" + target + "\"}"), dev), 422, "SF-DOM-0193");
        expectCode(perform(post(BASE + "/for-asset", fx.key()).contentType(MediaType.APPLICATION_JSON)
                .content("{\"assetUuid\":\"" + list + "\",\"toPath\":\"mailto:x@example.com\"}"), dev), 422, "SF-DOM-0193");
        expectCode(perform(post(BASE + "/for-asset", fx.key()).contentType(MediaType.APPLICATION_JSON)
                .content("{\"assetUuid\":\"" + UUID.randomUUID() + "\",\"toAssetUuid\":\"" + target + "\"}"), dev),
                422, "SF-DOM-0194");
        // Unpublished and rebuilt: the old paths are free, every redirect is active.
        publish(fx,
                pageOutput("de/ziel.html", target, "html", "de", null),
                pageOutput("en/target.html", target, "html", "en", null));
        perform(get(BASE, fx.key()), dev)
                .andExpect(jsonPath("$.rows", hasSize(6)))
                .andExpect(jsonPath("$.rows[?(@.state != 'ACTIVE')]", hasSize(0)))
                .andExpect(jsonPath("$.rows[5].resolvedTarget").value("en/target.html"));
    }

    @Test
    @DisplayName("for-asset without a published build is SF-DOM-0194")
    void forAssetWithoutBuild() throws Exception {
        Fixture fx = fixture("rdr-fa0", false);
        String dev = member(fx, ProjectRole.DEVELOPER);
        UUID page = page(fx, "page");
        UUID target = page(fx, "target");
        expectCode(perform(post(BASE + "/for-asset", fx.key()).contentType(MediaType.APPLICATION_JSON)
                .content("{\"assetUuid\":\"" + page + "\",\"toAssetUuid\":\"" + target + "\"}"), dev), 422, "SF-DOM-0194");
    }

    // ------------------------------------------------------------------
    // upsertAuto (the detection seam, M30.4.2)
    // ------------------------------------------------------------------

    @Test
    @DisplayName("upsertAuto adds new entries, re-points AUTO ones and never touches a MANUAL one")
    void upsertAuto() {
        Fixture fx = fixture("rdr-auto", false);
        UUID a = page(fx, "a");
        UUID b = page(fx, "b");
        redirects.create(fx.id(), new RedirectService.Command("html", "", "manual.html", null, null, "kept.html"),
                fx.admin().getId());

        AutoResult first = redirects.upsertAuto(fx.id(), 10L, List.of(
                new AutoCandidate("html", "", "a-old.html", a, 1),
                new AutoCandidate("html", null, "manual.html", a, 1)));
        assertThat(first).isEqualTo(new AutoResult(1, 0, 1));
        AutoResult second = redirects.upsertAuto(fx.id(), 11L, List.of(new AutoCandidate("html", "", "a-old.html", b, 2)));
        assertThat(second).isEqualTo(new AutoResult(0, 1, 0));

        RedirectEntry auto = entry(fx, "a-old.html");
        assertThat(auto.getKind()).isEqualTo(RedirectKind.AUTO);
        assertThat(auto.getToAssetUuid()).isEqualTo(b);
        assertThat(auto.getToPageNumber()).isEqualTo(2);
        assertThat(auto.getSourceRunId()).isEqualTo(11L);
        assertThat(auto.getCreatedBy()).isNull();
        assertThat(auto.getVersion()).isEqualTo(1);
        RedirectEntry manual = entry(fx, "manual.html");
        assertThat(manual.getKind()).isEqualTo(RedirectKind.MANUAL);
        assertThat(manual.getToPath()).isEqualTo("kept.html");
        assertThat(audit.findRecent(fx.id(), PageRequest.of(0, 100)))
                .filteredOn(e -> e.getAction().startsWith("REDIRECT_"))
                .extracting(AuditLog::getAction)
                .containsExactly("REDIRECT_CREATED");
    }

    // ------------------------------------------------------------------
    // Fixtures
    // ------------------------------------------------------------------

    private Fixture fixture(String prefix, boolean localized) {
        int n = SEQ.incrementAndGet();
        AppUser admin = users.create(prefix + n, prefix + n + "@example.com", "Admin", "secret-password");
        Project project = projects.create(
                new CreateProjectRequest(prefix.replace("-", "") + n, prefix + n, null, "redirect api"), admin.getId());
        RevisionContext ctx = RevisionContext.of(project.getId(), admin.getId(), "redirect api");
        if (localized) {
            projects.updateLocales(project.getKey(),
                    LocaleConfig.of(List.of(new ProjectLocale("de", "Deutsch"), new ProjectLocale("en", "English")), "de",
                            Map.of(), false),
                    true, ctx);
        }
        TemplateView template = templates.create(new CreateTemplateCommand(project.getId(), AssetType.PAGE_TEMPLATE, "Page", CDL,
                Map.of("html", "<h1>$CMS_VALUE(title)$</h1>"), null, false, Map.of()), ctx);
        GenerationTarget target;
        try {
            target = targets.save(new GenerationTarget(project.getId(), "default", TargetType.FILESYSTEM,
                    mapper.readTree("{\"baseUrl\":\"https://example.com\"}"), true));
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
        return new Fixture(project, admin, ctx, template, target);
    }

    private UUID page(Fixture fx, String name) {
        AssetVersionView view = pages.create(new CreatePageCommand(name, null, fx.template().uuid()), fx.ctx());
        return view.uuid();
    }

    private static BuildManifest.Output pageOutput(String path, UUID asset, String channel, String locale, Integer pageNumber) {
        return new BuildManifest.Output(path, BuildManifest.Kind.PAGE, asset, channel, pageNumber, locale, Set.of());
    }

    /** Publishes a synthetic build with these outputs to the fixture's default target; returns its run id. */
    private long publish(Fixture fx, BuildManifest.Output... outputs) {
        long runId = RUN.incrementAndGet();
        TargetWriter writer = writers.forTarget(fx.key(), fx.target());
        List<OutputFile> files = new ArrayList<>();
        for (BuildManifest.Output output : outputs) {
            files.add(new OutputFile(output.path(), output.path().getBytes(StandardCharsets.UTF_8)));
        }
        writer.stage(runId, files);
        writer.writeManifest(runId, new BuildManifest(BuildManifest.VERSION, runId, 1, 1, Set.of("html"), List.of(outputs)));
        writer.publish(runId);
        return runId;
    }

    private RedirectEntry entry(Fixture fx, String fromPath) {
        return entry(fx, "", fromPath);
    }

    private RedirectEntry entry(Fixture fx, String locale, String fromPath) {
        return redirectRepository.findByProjectIdAndChannelKeyAndLocaleKeyAndFromPath(fx.id(), "html", locale, fromPath)
                .orElseThrow();
    }

    private String member(Fixture fx, ProjectRole role) {
        int n = SEQ.incrementAndGet();
        AppUser user = users.create("r" + n + role.name().toLowerCase(), "r" + n + "@example.com", "Member", "secret-password");
        projects.setMemberRole(fx.key(), user.getId(), role, fx.ctx());
        return jwt.issueAccessToken(users.findById(user.getId()).orElseThrow());
    }

    private String stranger() {
        int n = SEQ.incrementAndGet();
        AppUser user = users.create("rx" + n, "rx" + n + "@example.com", "Stranger", "secret-password");
        return jwt.issueAccessToken(user);
    }

    private static String pathBody(String channel, String locale, String fromPath, String toPath) {
        return "{\"channel\":\"" + channel + "\"" + (locale == null ? "" : ",\"locale\":\"" + locale + "\"")
                + ",\"fromPath\":\"" + fromPath + "\",\"toPath\":\"" + toPath + "\"}";
    }

    private static String assetBody(String channel, String locale, String fromPath, UUID asset, Integer pageNumber) {
        return "{\"channel\":\"" + channel + "\",\"locale\":\"" + locale + "\",\"fromPath\":\"" + fromPath
                + "\",\"toAssetUuid\":\"" + asset + "\"" + (pageNumber == null ? "" : ",\"toPageNumber\":" + pageNumber) + "}";
    }

    private ResultActions create(Fixture fx, String token, String body) throws Exception {
        return perform(post(BASE, fx.key()).contentType(MediaType.APPLICATION_JSON).content(body), token);
    }

    private ResultActions perform(MockHttpServletRequestBuilder request, String token) throws Exception {
        return mvc.perform(request.header("Authorization", "Bearer " + token));
    }

    private static void expectCode(ResultActions result, int status, String code) throws Exception {
        result.andExpect(status().is(status)).andExpect(jsonPath("$.code").value(code));
    }

    private JsonNode json(MvcResult result) throws Exception {
        return mapper.readTree(result.getResponse().getContentAsString(StandardCharsets.UTF_8));
    }
}
