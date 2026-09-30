package com.acme.staticforge;

import static org.assertj.core.api.Assertions.assertThat;

import com.acme.staticforge.asset.AssetService;
import com.acme.staticforge.asset.AssetType;
import com.acme.staticforge.asset.AssetVersionView;
import com.acme.staticforge.asset.CreateAssetCommand;
import com.acme.staticforge.asset.UpdateAssetCommand;
import com.acme.staticforge.asset.template.CreateTemplateCommand;
import com.acme.staticforge.asset.template.TemplateService;
import com.acme.staticforge.asset.template.TemplateView;
import com.acme.staticforge.asset.template.UpdateTemplateCommand;
import com.acme.staticforge.project.CreateProjectRequest;
import com.acme.staticforge.project.Project;
import com.acme.staticforge.project.ProjectService;
import com.acme.staticforge.revision.RevisionContext;
import com.acme.staticforge.search.SearchHit;
import com.acme.staticforge.search.SearchIndexer;
import com.acme.staticforge.search.SearchService;
import com.acme.staticforge.template.cdl.CdlSources;
import com.acme.staticforge.user.AppUser;
import com.acme.staticforge.user.UserService;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.function.Consumer;

/**
 * Shared fixtures of the search tests (M23): projects, templates and pages built through the real services, and
 * searches run after indexing has settled.
 */
final class SearchFixtures {

    private static final AtomicInteger SEQ = new AtomicInteger();

    /** A page template with a rich-text body and a plain-text intro. */
    static final String PAGE_CDL = """
            content {
              editor text intro { label "Intro" }
              editor richtext body { label "Body" }
            }
            """;

    static final String PAGE_HTML = "<main>$CMS_VALUE(intro)$ $CMS_VALUE(body)$</main>";

    final ObjectMapper mapper = new ObjectMapper();

    private final UserService users;
    private final ProjectService projects;
    private final AssetService assets;
    private final TemplateService templates;
    private final SearchService search;
    private final SearchIndexer indexer;

    SearchFixtures(
            UserService users,
            ProjectService projects,
            AssetService assets,
            TemplateService templates,
            SearchService search,
            SearchIndexer indexer) {
        this.users = users;
        this.projects = projects;
        this.assets = assets;
        this.templates = templates;
        this.search = search;
        this.indexer = indexer;
    }

    record Fixture(Project project, AppUser user, RevisionContext ctx) {
        long projectId() {
            return project.getId();
        }

        String key() {
            return project.getKey();
        }
    }

    Fixture project(String prefix) {
        int n = SEQ.incrementAndGet();
        AppUser user = users.create(
                prefix + "-user-" + n, prefix + "-user-" + n + "@example.com", prefix + " user " + n, "secret-password");
        Project project = projects.create(
                new CreateProjectRequest(prefix + "p" + n, prefix + " project " + n, null, "search test"), user.getId());
        return new Fixture(project, user, RevisionContext.of(project.getId(), user.getId(), "search test"));
    }

    TemplateView pageTemplate(Fixture fx, String name) {
        return templates.create(new CreateTemplateCommand(
                fx.projectId(), AssetType.PAGE_TEMPLATE, name, CdlSources.split(PAGE_CDL), Map.of("html", PAGE_HTML), null, false,
                Map.of("html", "{displayNameSlug}.{ext}")), fx.ctx());
    }

    TemplateView sectionTemplate(Fixture fx, String name, String cdl, String html) {
        return templates.create(new CreateTemplateCommand(
                fx.projectId(), AssetType.SECTION_TEMPLATE, name, CdlSources.split(cdl), Map.of("html", html), null, false, null), fx.ctx());
    }

    TemplateView updateTemplate(Fixture fx, UUID uuid, String cdl, String html) {
        TemplateView now = templates.get(fx.projectId(), uuid);
        return templates.update(
                uuid,
                new UpdateTemplateCommand(now.displayName(), CdlSources.split(cdl), Map.of("html", html), null, false, Map.of(), false, Map.of()),
                now.validFromRevision(),
                fx.ctx());
    }

    /** A page on {@code template} with an intro and a rich-text body. */
    AssetVersionView page(Fixture fx, String name, UUID template, String intro, String bodyHtml) {
        return page(fx, name, template, payload -> {
            ObjectNode content = payload.withObject("content");
            content.put("intro", intro);
            content.putObject("body").put("format", "html").put("value", bodyHtml);
        });
    }

    AssetVersionView page(Fixture fx, String name, UUID template, Consumer<ObjectNode> customizer) {
        ObjectNode payload = mapper.createObjectNode();
        payload.put("templateRef", template.toString());
        payload.putObject("content");
        customizer.accept(payload);
        return assets.create(new CreateAssetCommand(fx.projectId(), AssetType.PAGE, name, null, payload, null), fx.ctx());
    }

    /** Adds a section of {@code section} to body {@code body}; returns its content object. */
    ObjectNode section(ObjectNode payload, String body, UUID section) {
        ObjectNode instance = payload.withObject("bodies").withArray(body).addObject();
        instance.put("instanceId", UUID.randomUUID().toString());
        instance.put("templateRef", section.toString());
        return instance.putObject("content");
    }

    AssetVersionView edit(Fixture fx, UUID uuid, Consumer<ObjectNode> change) {
        AssetVersionView now = assets.requireCurrent(fx.projectId(), uuid);
        ObjectNode payload = now.payload().deepCopy();
        change.accept(payload);
        return assets.update(uuid, new UpdateAssetCommand(now.displayName(), payload), now.validFromRevision(), fx.ctx());
    }

    void awaitIndexed() {
        try {
            assertThat(indexer.awaitIdle(Duration.ofSeconds(60))).as("search indexing settles").isTrue();
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException(e);
        }
    }

    /** The UUIDs a search finds once indexing has settled. */
    List<UUID> find(Fixture fx, String q) {
        awaitIndexed();
        return hits(fx, q).stream().map(SearchHit::uuid).toList();
    }

    List<SearchHit> hits(Fixture fx, String q) {
        return search.search(fx.projectId(), q, null, null, 0, 50, null).hits().hits();
    }
}
