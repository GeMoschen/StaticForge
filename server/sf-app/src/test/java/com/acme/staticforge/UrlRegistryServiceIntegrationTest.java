package com.acme.staticforge;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.acme.staticforge.asset.AssetService;
import com.acme.staticforge.asset.AssetType;
import com.acme.staticforge.asset.AssetVersionView;
import com.acme.staticforge.asset.UpdateAssetCommand;
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
import com.acme.staticforge.project.CreateProjectRequest;
import com.acme.staticforge.project.Project;
import com.acme.staticforge.project.ProjectService;
import com.acme.staticforge.revision.RevisionContext;
import com.acme.staticforge.template.cdl.CdlSources;
import com.acme.staticforge.urlregistry.ResetScope;
import com.acme.staticforge.urlregistry.UrlArea;
import com.acme.staticforge.urlregistry.UrlRegistryChangeRepository;
import com.acme.staticforge.urlregistry.UrlRegistryEntry;
import com.acme.staticforge.urlregistry.UrlRegistryRepository;
import com.acme.staticforge.urlregistry.UrlRegistryService;
import com.acme.staticforge.urlregistry.UrlTarget;
import com.acme.staticforge.urlregistry.UrlTargetType;
import com.acme.staticforge.user.AppUser;
import com.acme.staticforge.user.UserService;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.data.domain.Pageable;
import org.springframework.test.context.ActiveProfiles;

/**
 * {@link UrlRegistryService} tests (`M8.2.2`, every target since M32.2) against the real live repositories: assign
 * once (a first resolve computes and stores, later calls never recompute even after the page changes), page
 * references resolving to their page's row, overrides with their validation, every reset scope followed by
 * recomputation, concurrent first resolves, and the change records an incremental build reads.
 */
@SpringBootTest
@ActiveProfiles("test")
class UrlRegistryServiceIntegrationTest {

    private static final AtomicInteger SEQ = new AtomicInteger();

    @Autowired UserService userService;
    @Autowired ProjectService projectService;
    @Autowired AssetService assetService;
    @Autowired FolderService folderService;
    @Autowired PageService pageService;
    @Autowired PageReferenceService pageReferenceService;
    @Autowired TemplateService templateService;
    @Autowired UrlRegistryService urlRegistryService;
    @Autowired UrlRegistryRepository urlRegistryRepository;
    @Autowired UrlRegistryChangeRepository changeRepository;

    @Test
    void firstResolveComputesAndPersistsAndIsStableAcrossALaterPageEdit() {
        Fixture fx = newFixture();
        AssetVersionView page = createPage(fx, "Hammer Drill");

        String url = resolve(fx, page.uuid(), UrlArea.GENERATED);

        assertThat(url).isEqualTo("hammer-drill.html");
        UrlRegistryEntry persisted = row(fx, UrlTarget.page(page.uuid()), UrlArea.GENERATED).orElseThrow();
        assertThat(persisted.getUrl()).isEqualTo(url);
        assertThat(persisted.isOverridden()).isFalse();

        // Edit the page: its slug-derived URL would be different if recomputed.
        assetService.update(
                page.uuid(), new UpdateAssetCommand("Totally Different Title", page.payload()), page.validFromRevision(),
                fx.ctx());

        assertThat(resolve(fx, page.uuid(), UrlArea.GENERATED)).isEqualTo(url);
    }

    @Test
    void aPageReferenceUsesItsPagesRowAndHasNoneOfItsOwn() {
        Fixture fx = newFixture();
        AssetVersionView page = createPage(fx, "About Us");
        AssetVersionView reference = createPageRef(fx, page);

        String url = urlRegistryService.resolvePageReference(reference.uuid(), "html", UrlArea.GENERATED, null, fx.ctx());

        assertThat(url).isEqualTo("about-us.html");
        assertThat(row(fx, UrlTarget.page(page.uuid()), UrlArea.GENERATED)).isPresent();
        assertThat(urlRegistryRepository.findByProjectIdAndTargetUuid(fx.project().getId(), reference.uuid())).isEmpty();
    }

    /**
     * Previews resolve links on parallel requests, so many threads may resolve the same absent tuple at once. All of
     * them must get the URL and exactly one row must exist — losing the insert race must not surface as an error.
     */
    @Test
    void concurrentFirstResolvesOfTheSameTupleAllSucceedWithOneRow() throws Exception {
        Fixture fx = newFixture();
        AssetVersionView page = createPage(fx, "Shared Nav Target");
        int threads = 16;
        CountDownLatch start = new CountDownLatch(1);
        List<Future<String>> results = new ArrayList<>();
        try (ExecutorService executor = Executors.newVirtualThreadPerTaskExecutor()) {
            for (int i = 0; i < threads; i++) {
                results.add(executor.submit(() -> {
                    start.await();
                    return resolve(fx, page.uuid(), UrlArea.GENERATED);
                }));
            }
            start.countDown();
            Set<String> urls = new HashSet<>();
            for (Future<String> result : results) {
                urls.add(result.get());
            }
            assertThat(urls).containsExactly("shared-nav-target.html");
        }
        assertThat(urlRegistryRepository.findByProjectIdAndTargetUuid(fx.project().getId(), page.uuid())).hasSize(1);
    }

    @Test
    void overrideMakesSubsequentResolveCallsReturnTheManualValueMarkedOverridden() {
        Fixture fx = newFixture();
        AssetVersionView page = createPage(fx, "About Us");
        resolve(fx, page.uuid(), UrlArea.GENERATED);
        Instant before = Instant.now().minusSeconds(1);

        UrlRegistryEntry overridden = urlRegistryService.override(
                UrlTarget.page(page.uuid()), "html", UrlArea.GENERATED, "", "custom/about-us.html", fx.ctx());

        assertThat(overridden.getUrl()).isEqualTo("custom/about-us.html");
        assertThat(overridden.isOverridden()).isTrue();
        assertThat(resolve(fx, page.uuid(), UrlArea.GENERATED)).isEqualTo("custom/about-us.html");
        assertThat(row(fx, UrlTarget.page(page.uuid()), UrlArea.GENERATED).orElseThrow().isOverridden()).isTrue();
        assertThat(urlRegistryService.changesSince(fx.project().getId(), UrlArea.GENERATED, before))
                .singleElement()
                .satisfies(change -> {
                    assertThat(change.getTargetUuid()).isEqualTo(page.uuid());
                    assertThat(change.getTargetType()).isEqualTo(UrlTargetType.PAGE);
                });
    }

    @Test
    void overrideWithNoExistingEntryUpsertsANewOverriddenRow() {
        Fixture fx = newFixture();
        AssetVersionView page = createPage(fx, "Fresh Page");

        UrlRegistryEntry overridden = urlRegistryService.override(
                UrlTarget.page(page.uuid()), "html", UrlArea.PREVIEW, "", "manual/fresh.html", fx.ctx());

        assertThat(overridden.getUrl()).isEqualTo("manual/fresh.html");
        assertThat(overridden.isOverridden()).isTrue();
    }

    @Test
    void overrideOntoAnotherPagesUrlIsRefused() {
        Fixture fx = newFixture();
        AssetVersionView about = createPage(fx, "About");
        AssetVersionView team = createPage(fx, "Team");
        resolve(fx, about.uuid(), UrlArea.GENERATED);

        assertThatThrownBy(() -> urlRegistryService.override(
                        UrlTarget.page(team.uuid()), "html", UrlArea.GENERATED, "", "about.html", fx.ctx()))
                .isInstanceOf(SfException.class)
                .satisfies(e -> {
                    assertThat(((SfException) e).getStatus()).isEqualTo(409);
                    assertThat(((SfException) e).getProblem().getExtensions())
                            .containsEntry("code", "SF-DOM-0200")
                            .containsEntry("holderUuid", about.uuid().toString());
                });
        // Another area, or another channel, is free.
        urlRegistryService.override(UrlTarget.page(team.uuid()), "html", UrlArea.PREVIEW, "", "about.html", fx.ctx());
    }

    @Test
    void aFolderWithAnIndexPageHasNoUrlOfItsOwn() {
        Fixture fx = newFixture();
        AssetVersionView products = folderService.create(null, "Products", FolderScope.PAGES, fx.ctx());
        AssetVersionView empty = folderService.create(null, "Empty", FolderScope.PAGES, fx.ctx());
        createPage(fx, "Index", products.uuid());

        assertThatThrownBy(() -> urlRegistryService.override(
                        UrlTarget.folder(products.uuid()), "html", UrlArea.GENERATED, "", "shop/", fx.ctx()))
                .isInstanceOf(SfException.class)
                .satisfies(e -> assertThat(((SfException) e).getProblem().getExtensions())
                        .containsEntry("code", "SF-DOM-0201"));
        assertThat(urlRegistryService.override(
                        UrlTarget.folder(empty.uuid()), "html", UrlArea.GENERATED, "", "nothing-here/", fx.ctx())
                .getUrl())
                .isEqualTo("nothing-here/");
        assertThat(urlRegistryService.indexPages(fx.project().getId(), products.uuid())).singleElement()
                .extracting(UrlRegistryService.IndexPage::channelKey).isEqualTo("html");
    }

    @Test
    void resetEntryScopeDeletesOnlyThatRow() {
        Fixture fx = newFixture();
        long projectId = fx.project().getId();
        UrlRegistryEntry a = urlRegistryRepository.save(entry(projectId, "html", UUID.randomUUID(), UrlArea.GENERATED, "a.html"));
        UrlRegistryEntry b = urlRegistryRepository.save(entry(projectId, "html", UUID.randomUUID(), UrlArea.GENERATED, "b.html"));

        urlRegistryService.reset(projectId, ResetScope.entry(a.getId()), fx.ctx());

        assertThat(urlRegistryRepository.findById(a.getId())).isEmpty();
        assertThat(urlRegistryRepository.findById(b.getId())).isPresent();
    }

    @Test
    void resetAssetScopeDeletesEveryRowOfTheAsset() {
        Fixture fx = newFixture();
        long projectId = fx.project().getId();
        UUID page = UUID.randomUUID();
        urlRegistryRepository.save(entry(projectId, "html", page, UrlArea.GENERATED, "p.html"));
        urlRegistryRepository.save(new UrlRegistryEntry(projectId, "html", UrlTarget.page(page, 2), UrlArea.GENERATED, "",
                "p-2.html", Instant.now(), 1L, true));
        urlRegistryRepository.save(entry(projectId, "html", page, UrlArea.PREVIEW, "p.html"));
        UrlRegistryEntry other = urlRegistryRepository.save(entry(projectId, "html", UUID.randomUUID(), UrlArea.GENERATED, "o.html"));

        urlRegistryService.reset(projectId, ResetScope.asset(page, UrlArea.GENERATED), fx.ctx());

        assertThat(urlRegistryRepository.findByProjectIdAndTargetUuid(projectId, page))
                .singleElement().extracting(UrlRegistryEntry::getArea).isEqualTo(UrlArea.PREVIEW);
        assertThat(urlRegistryRepository.findById(other.getId())).isPresent();

        urlRegistryService.reset(projectId, ResetScope.asset(page, null), fx.ctx());
        assertThat(urlRegistryRepository.findByProjectIdAndTargetUuid(projectId, page)).isEmpty();
    }

    @Test
    void resetChannelScopeDeletesOnlyThatChannel() {
        Fixture fx = newFixture();
        long projectId = fx.project().getId();
        urlRegistryRepository.save(entry(projectId, "html", UUID.randomUUID(), UrlArea.GENERATED, "1.html"));
        urlRegistryRepository.save(entry(projectId, "markdown", UUID.randomUUID(), UrlArea.GENERATED, "2.md"));

        urlRegistryService.reset(projectId, ResetScope.channel("html"), fx.ctx());

        assertThat(count(projectId, "html", null)).isZero();
        assertThat(count(projectId, "markdown", null)).isEqualTo(1);
    }

    @Test
    void resetAreaScopeDeletesOnlyThatAreaAcrossChannels() {
        Fixture fx = newFixture();
        long projectId = fx.project().getId();
        urlRegistryRepository.save(entry(projectId, "html", UUID.randomUUID(), UrlArea.PREVIEW, "1.html"));
        urlRegistryRepository.save(entry(projectId, "markdown", UUID.randomUUID(), UrlArea.PREVIEW, "2.md"));
        urlRegistryRepository.save(entry(projectId, "html", UUID.randomUUID(), UrlArea.GENERATED, "3.html"));
        Instant before = Instant.now().minusSeconds(1);

        urlRegistryService.reset(projectId, ResetScope.area(UrlArea.PREVIEW), fx.ctx());

        assertThat(count(projectId, null, UrlArea.PREVIEW)).isZero();
        assertThat(count(projectId, null, UrlArea.GENERATED)).isEqualTo(1);
        assertThat(urlRegistryService.changesSince(projectId, UrlArea.PREVIEW, before))
                .singleElement().satisfies(change -> assertThat(change.wide()).isTrue());
        assertThat(urlRegistryService.changesSince(projectId, UrlArea.GENERATED, before)).isEmpty();
    }

    @Test
    void resetProjectScopeDeletesEveryEntryForTheProjectOnly() {
        Fixture fx = newFixture();
        Fixture other = newFixture();
        long projectId = fx.project().getId();
        urlRegistryRepository.save(entry(projectId, "html", UUID.randomUUID(), UrlArea.GENERATED, "1.html"));
        urlRegistryRepository.save(entry(projectId, "html", UUID.randomUUID(), UrlArea.PREVIEW, "2.html"));
        urlRegistryRepository.save(entry(other.project().getId(), "html", UUID.randomUUID(), UrlArea.GENERATED, "o.html"));

        urlRegistryService.reset(projectId, ResetScope.project(), fx.ctx());

        assertThat(count(projectId, null, null)).isZero();
        assertThat(count(other.project().getId(), null, null)).isEqualTo(1);
    }

    @Test
    void resolveAfterResetRecomputesFreshAndClearsOverridden() {
        Fixture fx = newFixture();
        AssetVersionView page = createPage(fx, "Reset Me");
        String originalUrl = resolve(fx, page.uuid(), UrlArea.GENERATED);
        urlRegistryService.override(
                UrlTarget.page(page.uuid()), "html", UrlArea.GENERATED, "", "manual/reset-me.html", fx.ctx());
        assertThat(resolve(fx, page.uuid(), UrlArea.GENERATED)).isEqualTo("manual/reset-me.html");

        Long entryId = row(fx, UrlTarget.page(page.uuid()), UrlArea.GENERATED).orElseThrow().getId();
        urlRegistryService.reset(fx.project().getId(), ResetScope.entry(entryId), fx.ctx());
        assertThat(urlRegistryRepository.findById(entryId)).isEmpty();

        assertThat(resolve(fx, page.uuid(), UrlArea.GENERATED)).isEqualTo(originalUrl);
        assertThat(row(fx, UrlTarget.page(page.uuid()), UrlArea.GENERATED).orElseThrow().isOverridden()).isFalse();
    }

    @Test
    void searchFindsRowsByTheirTargetsName() {
        Fixture fx = newFixture();
        AssetVersionView hammer = createPage(fx, "Hammer Drill");
        AssetVersionView saw = createPage(fx, "Saw");
        resolve(fx, hammer.uuid(), UrlArea.GENERATED);
        resolve(fx, saw.uuid(), UrlArea.GENERATED);

        assertThat(urlRegistryService.search(fx.project().getId(),
                        new UrlRegistryService.Filter(null, null, null, null, null, "hammer"), Pageable.unpaged()))
                .extracting(UrlRegistryEntry::getTargetUuid).containsExactly(hammer.uuid());
        assertThat(urlRegistryService.search(fx.project().getId(),
                        new UrlRegistryService.Filter(null, null, null, null, null, "saw.html"), Pageable.unpaged()))
                .extracting(UrlRegistryEntry::getTargetUuid).containsExactly(saw.uuid());
        assertThat(urlRegistryService.describe(fx.project().getId(), Set.of(hammer.uuid())).get(hammer.uuid()).displayName())
                .isEqualTo("Hammer Drill");
    }

    // ------------------------------------------------------------------

    private String resolve(Fixture fx, UUID page, UrlArea area) {
        return urlRegistryService.resolvePage(page, 1, "html", area, null, fx.ctx());
    }

    private Optional<UrlRegistryEntry> row(Fixture fx, UrlTarget target, UrlArea area) {
        return urlRegistryRepository.findTuple(fx.project().getId(), target.channelKey("html"), area, "", target.type(),
                target.uuid(), target.variant(), target.pageNumber());
    }

    private long count(long projectId, String channel, UrlArea area) {
        return urlRegistryService.search(projectId, new UrlRegistryService.Filter(channel, area, null, null, null, null),
                        Pageable.unpaged())
                .getTotalElements();
    }

    private AssetVersionView createPageRef(Fixture fx, AssetVersionView page) {
        AssetVersionView navFolder = navRoot(fx);
        return pageReferenceService.create(
                new CreatePageReferenceCommand(
                        page.displayName() + " Link", navFolder.uuid(), PageReferenceTargetKind.PAGE, page.uuid(), null),
                fx.ctx());
    }

    /** A fresh top-level `NAVIGATION` folder — nothing is pre-provisioned any more, so each test
     * that needs one creates its own. */
    private AssetVersionView navRoot(Fixture fx) {
        return folderService.create(null, "Nav Root " + SEQ.incrementAndGet(), FolderScope.NAVIGATION, fx.ctx());
    }

    private AssetVersionView createPage(Fixture fx, String name) {
        return createPage(fx, name, null);
    }

    private AssetVersionView createPage(Fixture fx, String name, UUID folder) {
        TemplateView pageTemplate = templateService.create(
                new CreateTemplateCommand(
                        fx.project().getId(),
                        AssetType.PAGE_TEMPLATE,
                        name + " Template " + SEQ.incrementAndGet(),
                        CdlSources.split("content { editor text title { required } }"),
                        Map.of("html", "<h1>$CMS_VALUE(title)$</h1>"),
                        null,
                        false,
                        Map.of("html", "{folder}{displayNameSlug}.{ext}")),
                fx.ctx());
        return pageService.create(new CreatePageCommand(name, folder, pageTemplate.uuid()), fx.ctx());
    }

    private static UrlRegistryEntry entry(long projectId, String channelKey, UUID page, UrlArea area, String url) {
        return new UrlRegistryEntry(projectId, channelKey, UrlTarget.page(page), area, "", url, Instant.now(), 1L, false);
    }

    private Fixture newFixture() {
        int n = SEQ.incrementAndGet();
        AppUser user = userService.create("urlregsvc-user-" + n, "urlregsvc-user-" + n + "@example.com", "UrlRegSvc User " + n, "secret-password");
        Project project = projectService.create(
                new CreateProjectRequest("urlregsvcp_" + n, "UrlRegSvc Project " + n, null, null), user.getId());
        return new Fixture(project, user);
    }

    private record Fixture(Project project, AppUser user) {
        RevisionContext ctx() {
            return RevisionContext.of(project().getId(), user().getId(), "test");
        }
    }
}
