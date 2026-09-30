package com.acme.staticforge;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.acme.staticforge.asset.AssetService;
import com.acme.staticforge.asset.AssetType;
import com.acme.staticforge.asset.AssetVersionView;
import com.acme.staticforge.asset.folder.FolderService;
import com.acme.staticforge.asset.media.MediaService;
import com.acme.staticforge.asset.page.CreatePageCommand;
import com.acme.staticforge.asset.page.PageService;
import com.acme.staticforge.asset.template.CreateTemplateCommand;
import com.acme.staticforge.asset.template.TemplateService;
import com.acme.staticforge.asset.template.TemplateView;
import com.acme.staticforge.common.SfException;
import com.acme.staticforge.project.CreateProjectRequest;
import com.acme.staticforge.project.Project;
import com.acme.staticforge.project.ProjectService;
import com.acme.staticforge.release.AssetReleaseRepository;
import com.acme.staticforge.release.ReleaseItem;
import com.acme.staticforge.release.ReleaseService;
import com.acme.staticforge.revision.RevisionContext;
import com.acme.staticforge.revision.RevisionRepository;
import com.acme.staticforge.template.cdl.CdlSources;
import com.acme.staticforge.user.AppUser;
import com.acme.staticforge.user.UserService;
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
 * A release of a large selection costs a fixed number of reads (M27.1.4): the same selection shape with four times the
 * items runs exactly as many queries — only the pointer inserts grow, one per released item. Per-item reads made a
 * 10,000-item release take minutes (every query in the write transaction auto-flushed, dirty-checking everything
 * loaded so far). {@code ReleaseBenchmark} measures the same at scale.
 *
 * <p>Statements are counted on the test's thread only ({@link ThreadStatementCounter}): the context's scheduler and
 * search indexer query the database in the background, and would otherwise land in any measured window.
 */
@SpringBootTest(properties =
        "spring.jpa.properties.hibernate.session_factory.statement_inspector=com.acme.staticforge.ThreadStatementCounter")
@ActiveProfiles("test")
class ReleaseQueryCountIntegrationTest {

    private static final AtomicInteger SEQ = new AtomicInteger();

    private static final String CDL =
            "content { editor text title { label \"Title\" required } editor media image { label \"Image\" } }";

    @Autowired UserService userService;
    @Autowired ProjectService projectService;
    @Autowired AssetService assetService;
    @Autowired FolderService folderService;
    @Autowired PageService pageService;
    @Autowired TemplateService templateService;
    @Autowired MediaService mediaService;
    @Autowired ReleaseService releases;
    @Autowired AssetReleaseRepository pointers;
    @Autowired RevisionRepository revisionRepository;

    private record Site(Project project, RevisionContext ctx, List<ReleaseItem> items, UUID empty) {}

    /** Pages in three folders, each referencing one shared media asset; every folder, page and the media unreleased. */
    private Site site(int pages) {
        int n = SEQ.incrementAndGet();
        AppUser user = userService.create("relq" + n, "relq" + n + "@example.com", "Release Queries", "secret-password");
        Project project = projectService.create(new CreateProjectRequest("relq" + n, "relq" + n, null, "release queries"), user.getId());
        RevisionContext ctx = RevisionContext.of(project.getId(), user.getId(), "release queries");
        TemplateView template = templateService.create(
                new CreateTemplateCommand(project.getId(), AssetType.PAGE_TEMPLATE, "Page", CdlSources.split(CDL),
                        Map.of("html", "<h1>$CMS_VALUE(title)$</h1>"), null, false, Map.of("html", "{folder}{uid}.{ext}")),
                ctx);
        AssetVersionView media = mediaService.upload(
                project.getId(), null, "logo.txt", null, "logo".getBytes(StandardCharsets.UTF_8), ctx);
        UUID pagesRoot = assetService.ensurePagesRootFolder(project.getId(), ctx).uuid();
        List<ReleaseItem> items = new ArrayList<>(List.of(ReleaseItem.of(media.uuid())));
        List<UUID> folders = new ArrayList<>();
        for (int f = 0; f < 3; f++) {
            UUID folder = folderService.create(pagesRoot, "f" + f, null, ctx).uuid();
            folders.add(folder);
            items.add(ReleaseItem.of(folder));
        }
        for (int i = 0; i < pages; i++) {
            items.add(ReleaseItem.of(page(ctx, template, folders.get(i % folders.size()), "p" + i, "Page " + i, media.uuid())));
        }
        UUID empty = page(ctx, template, folders.get(0), "empty", null, media.uuid());
        return new Site(project, ctx, items, empty);
    }

    private UUID page(RevisionContext ctx, TemplateView template, UUID folder, String name, String title, UUID media) {
        AssetVersionView page = pageService.create(new CreatePageCommand(name, folder, template.uuid()), ctx);
        ObjectNode payload = page.payload().deepCopy();
        ObjectNode content = payload.withObject("content");
        if (title != null) {
            content.put("title", title);
        }
        content.putObject("image").put("type", "MEDIA_REF").put("uuid", media.toString());
        pageService.update(page.uuid(), payload, page.validFromRevision(), ctx);
        return page.uuid();
    }

    @Test
    @DisplayName("releasing four times the items runs the same reads; only one pointer insert per item is added")
    void releaseReadsDoNotGrowWithTheSelection() {
        Site warmUp = site(5);
        releases.release(warmUp.items(), warmUp.ctx());
        Site small = site(10);
        Site large = site(40);

        ThreadStatementCounter.Counts smallPlan = count(small, () -> releases.plan(small.project().getId(), small.items()));
        ThreadStatementCounter.Counts largePlan = count(large, () -> releases.plan(large.project().getId(), large.items()));
        assertThat(largePlan.selects()).as("plan reads").isEqualTo(smallPlan.selects());
        assertThat(largePlan.inserts() + largePlan.other()).as("plan writes").isZero();

        ThreadStatementCounter.Counts smallRelease = count(small, () -> releases.release(small.items(), small.ctx()));
        ThreadStatementCounter.Counts largeRelease = count(large, () -> releases.release(large.items(), large.ctx()));
        assertThat(largeRelease.selects()).as("release reads").isEqualTo(smallRelease.selects());
        assertThat(largeRelease.other()).as("release updates").isEqualTo(smallRelease.other());
        assertThat(largeRelease.inserts() - smallRelease.inserts())
                .as("one pointer insert per additional item")
                .isEqualTo(large.items().size() - small.items().size());
        assertThat(pointers.findByProjectIdAndValidToRevisionIsNull(large.project().getId())).hasSize(large.items().size());
    }

    @Test
    @DisplayName("an incomplete page in a large selection refuses the whole release and writes nothing")
    void refusalInALargeSelectionWritesNothing() {
        Site site = site(40);
        List<ReleaseItem> items = new ArrayList<>(site.items());
        items.add(ReleaseItem.of(site.empty()));
        long revisions = revisionRepository.findByProjectIdOrderByRevisionIdDesc(site.project().getId()).size();

        assertThatThrownBy(() -> releases.release(items, site.ctx()))
                .isInstanceOfSatisfying(SfException.class, e ->
                        assertThat(e.getProblem().getExtensions()).containsEntry("code", "SF-DOM-0150"));

        assertThat(revisionRepository.findByProjectIdOrderByRevisionIdDesc(site.project().getId())).hasSize((int) revisions);
        assertThat(pointers.findByProjectIdAndValidToRevisionIsNull(site.project().getId())).isEmpty();
    }

    /**
     * The statements {@code call} runs for {@code site}. An unmeasured plan of the same site goes first: the project's
     * shared caches (its settings, templates) are then equally warm for every measured call, whatever ran before —
     * so what differs is only what depends on the selection.
     */
    private ThreadStatementCounter.Counts count(Site site, Runnable call) {
        releases.plan(site.project().getId(), site.items());
        return ThreadStatementCounter.during(call);
    }
}
