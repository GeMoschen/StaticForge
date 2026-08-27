package com.acme.staticforge;

import static org.assertj.core.api.Assertions.assertThat;

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
import com.acme.staticforge.project.CreateProjectRequest;
import com.acme.staticforge.project.Project;
import com.acme.staticforge.project.ProjectService;
import com.acme.staticforge.revision.RevisionContext;
import com.acme.staticforge.urlregistry.ResetScope;
import com.acme.staticforge.urlregistry.UrlArea;
import com.acme.staticforge.urlregistry.UrlRegistryEntry;
import com.acme.staticforge.urlregistry.UrlRegistryRepository;
import com.acme.staticforge.urlregistry.UrlRegistryService;
import com.acme.staticforge.user.AppUser;
import com.acme.staticforge.user.UserService;
import java.time.Instant;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.data.domain.PageRequest;
import org.springframework.test.context.ActiveProfiles;

/**
 * {@link UrlRegistryService} tests (`M8.2.2`) against the real live repositories: the
 * read-through-cache contract (first {@code resolve} computes+persists, later calls never
 * recompute even after the underlying page changes), {@code override}, and every {@code reset}
 * scope followed by lazy repopulation. Race-safety on the unique-constraint catch-and-reread
 * path is covered separately (with mocks, so the race is deterministic) by
 * {@code UrlRegistryServiceImplTest} (sf-domain).
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

    @Test
    void firstResolveComputesAndPersistsAndIsStableAcrossALaterPageEdit() {
        Fixture fx = newFixture();
        AssetVersionView pageRef = createPageRef(fx, "Hammer Drill");

        String url = urlRegistryService.resolve(pageRef.uuid(), "html", UrlArea.GENERATED, fx.ctx());

        assertThat(url).isEqualTo("hammer-drill.html");
        UrlRegistryEntry persisted = urlRegistryRepository
                .findByProjectIdAndChannelKeyAndPageReferenceUuidAndArea(fx.project().getId(), "html", pageRef.uuid(), UrlArea.GENERATED)
                .orElseThrow();
        assertThat(persisted.getUrl()).isEqualTo(url);
        assertThat(persisted.isOverridden()).isFalse();

        // Edit the underlying page: its slug-derived URL would be different if recomputed.
        AssetVersionView targetPage = assetService.requireCurrent(fx.project().getId(), pageTargetUuid(pageRef));
        assetService.update(
                targetPage.uuid(),
                new UpdateAssetCommand("Totally Different Title", targetPage.payload()),
                targetPage.validFromRevision(),
                fx.ctx());

        String urlAfterEdit = urlRegistryService.resolve(pageRef.uuid(), "html", UrlArea.GENERATED, fx.ctx());

        assertThat(urlAfterEdit).isEqualTo(url);
    }

    @Test
    void overrideMakesSubsequentResolveCallsReturnTheManualValueMarkedOverridden() {
        Fixture fx = newFixture();
        AssetVersionView pageRef = createPageRef(fx, "About Us");
        urlRegistryService.resolve(pageRef.uuid(), "html", UrlArea.GENERATED, fx.ctx());

        UrlRegistryEntry overridden =
                urlRegistryService.override(pageRef.uuid(), "html", UrlArea.GENERATED, "custom/about-us.html", fx.ctx());

        assertThat(overridden.getUrl()).isEqualTo("custom/about-us.html");
        assertThat(overridden.isOverridden()).isTrue();
        assertThat(urlRegistryService.resolve(pageRef.uuid(), "html", UrlArea.GENERATED, fx.ctx()))
                .isEqualTo("custom/about-us.html");
        assertThat(urlRegistryRepository
                        .findByProjectIdAndChannelKeyAndPageReferenceUuidAndArea(
                                fx.project().getId(), "html", pageRef.uuid(), UrlArea.GENERATED)
                        .orElseThrow()
                        .isOverridden())
                .isTrue();
    }

    @Test
    void overrideWithNoExistingEntryUpsertsANewOverriddenRow() {
        Fixture fx = newFixture();
        AssetVersionView pageRef = createPageRef(fx, "Fresh Page");

        UrlRegistryEntry overridden =
                urlRegistryService.override(pageRef.uuid(), "html", UrlArea.PREVIEW, "manual/fresh.html", fx.ctx());

        assertThat(overridden.getUrl()).isEqualTo("manual/fresh.html");
        assertThat(overridden.isOverridden()).isTrue();
    }

    @Test
    void resetEntryScopeDeletesOnlyThatRow() {
        Fixture fx = newFixture();
        long projectId = fx.project().getId();
        UrlRegistryEntry a = urlRegistryRepository.save(entry(projectId, "html", UUID.randomUUID(), UrlArea.GENERATED, "/a/"));
        UrlRegistryEntry b = urlRegistryRepository.save(entry(projectId, "html", UUID.randomUUID(), UrlArea.GENERATED, "/b/"));

        urlRegistryService.reset(projectId, ResetScope.entry(a.getId()), fx.ctx());

        assertThat(urlRegistryRepository.findById(a.getId())).isEmpty();
        assertThat(urlRegistryRepository.findById(b.getId())).isPresent();
    }

    @Test
    void resetChannelScopeDeletesOnlyThatChannel() {
        Fixture fx = newFixture();
        long projectId = fx.project().getId();
        urlRegistryRepository.save(entry(projectId, "html", UUID.randomUUID(), UrlArea.GENERATED, "/1/"));
        urlRegistryRepository.save(entry(projectId, "markdown", UUID.randomUUID(), UrlArea.GENERATED, "/2/"));

        urlRegistryService.reset(projectId, ResetScope.channel("html"), fx.ctx());

        assertThat(urlRegistryRepository.search(projectId, "html", null, PageRequest.of(0, 10)).getTotalElements())
                .isZero();
        assertThat(urlRegistryRepository.search(projectId, "markdown", null, PageRequest.of(0, 10)).getTotalElements())
                .isEqualTo(1);
    }

    @Test
    void resetAreaScopeDeletesOnlyThatAreaAcrossChannels() {
        Fixture fx = newFixture();
        long projectId = fx.project().getId();
        urlRegistryRepository.save(entry(projectId, "html", UUID.randomUUID(), UrlArea.PREVIEW, "/1/"));
        urlRegistryRepository.save(entry(projectId, "markdown", UUID.randomUUID(), UrlArea.PREVIEW, "/2/"));
        urlRegistryRepository.save(entry(projectId, "html", UUID.randomUUID(), UrlArea.GENERATED, "/3/"));

        urlRegistryService.reset(projectId, ResetScope.area(UrlArea.PREVIEW), fx.ctx());

        assertThat(urlRegistryRepository.search(projectId, null, UrlArea.PREVIEW, PageRequest.of(0, 10)).getTotalElements())
                .isZero();
        assertThat(urlRegistryRepository.search(projectId, null, UrlArea.GENERATED, PageRequest.of(0, 10)).getTotalElements())
                .isEqualTo(1);
    }

    @Test
    void resetProjectScopeDeletesEveryEntryForTheProjectOnly() {
        Fixture fx = newFixture();
        Fixture other = newFixture();
        long projectId = fx.project().getId();
        urlRegistryRepository.save(entry(projectId, "html", UUID.randomUUID(), UrlArea.GENERATED, "/1/"));
        urlRegistryRepository.save(entry(projectId, "html", UUID.randomUUID(), UrlArea.PREVIEW, "/2/"));
        urlRegistryRepository.save(
                entry(other.project().getId(), "html", UUID.randomUUID(), UrlArea.GENERATED, "/other/"));

        urlRegistryService.reset(projectId, ResetScope.project(), fx.ctx());

        assertThat(urlRegistryRepository.search(projectId, null, null, PageRequest.of(0, 10)).getTotalElements())
                .isZero();
        assertThat(urlRegistryRepository.search(other.project().getId(), null, null, PageRequest.of(0, 10)).getTotalElements())
                .isEqualTo(1);
    }

    @Test
    void resolveAfterResetRecomputesFreshAndClearsOverridden() {
        Fixture fx = newFixture();
        AssetVersionView pageRef = createPageRef(fx, "Reset Me");
        String originalUrl = urlRegistryService.resolve(pageRef.uuid(), "html", UrlArea.GENERATED, fx.ctx());
        urlRegistryService.override(pageRef.uuid(), "html", UrlArea.GENERATED, "manual/reset-me.html", fx.ctx());
        assertThat(urlRegistryService.resolve(pageRef.uuid(), "html", UrlArea.GENERATED, fx.ctx()))
                .isEqualTo("manual/reset-me.html");

        Long entryId = urlRegistryRepository
                .findByProjectIdAndChannelKeyAndPageReferenceUuidAndArea(fx.project().getId(), "html", pageRef.uuid(), UrlArea.GENERATED)
                .orElseThrow()
                .getId();
        urlRegistryService.reset(fx.project().getId(), ResetScope.entry(entryId), fx.ctx());
        assertThat(urlRegistryRepository.findById(entryId)).isEmpty();

        String recomputed = urlRegistryService.resolve(pageRef.uuid(), "html", UrlArea.GENERATED, fx.ctx());

        assertThat(recomputed).isEqualTo(originalUrl);
        UrlRegistryEntry fresh = urlRegistryRepository
                .findByProjectIdAndChannelKeyAndPageReferenceUuidAndArea(fx.project().getId(), "html", pageRef.uuid(), UrlArea.GENERATED)
                .orElseThrow();
        assertThat(fresh.isOverridden()).isFalse();
    }

    // ------------------------------------------------------------------

    private UUID pageTargetUuid(AssetVersionView pageRef) {
        return UUID.fromString(pageRef.payload().path("target").path("assetUuid").asText());
    }

    private AssetVersionView createPageRef(Fixture fx, String pageDisplayName) {
        AssetVersionView navFolder = navRoot(fx);
        AssetVersionView page = createPage(fx, pageDisplayName);
        return pageReferenceService.create(
                new CreatePageReferenceCommand(pageDisplayName + " Link", navFolder.uuid(), PageReferenceTargetKind.PAGE, page.uuid(), null),
                fx.ctx());
    }

    /** A fresh top-level `NAVIGATION` folder — nothing is pre-provisioned any more, so each test
     * that needs one creates its own. */
    private AssetVersionView navRoot(Fixture fx) {
        return folderService.create(null, "Nav Root " + SEQ.incrementAndGet(), FolderScope.NAVIGATION, fx.ctx());
    }

    private AssetVersionView createPage(Fixture fx, String name) {
        TemplateView pageTemplate = templateService.create(
                new CreateTemplateCommand(
                        fx.project().getId(),
                        AssetType.PAGE_TEMPLATE,
                        name + " Template " + SEQ.incrementAndGet(),
                        "content { editor text title { required } }",
                        Map.of("html", "<h1>$CMS_VALUE(title)$</h1>"),
                        null,
                        false,
                        Map.of("html", "{folder}{displayNameSlug}.{ext}")),
                fx.ctx());
        return pageService.create(new CreatePageCommand(name, null, pageTemplate.uuid()), fx.ctx());
    }

    private static UrlRegistryEntry entry(long projectId, String channelKey, UUID pageRefUuid, UrlArea area, String url) {
        return new UrlRegistryEntry(projectId, channelKey, pageRefUuid, area, url, Instant.now(), 1L, false);
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
