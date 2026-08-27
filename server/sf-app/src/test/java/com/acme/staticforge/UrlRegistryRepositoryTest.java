package com.acme.staticforge;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.acme.staticforge.asset.AssetService;
import com.acme.staticforge.asset.AssetType;
import com.acme.staticforge.asset.AssetVersionView;
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
import com.acme.staticforge.urlregistry.UrlArea;
import com.acme.staticforge.urlregistry.UrlRegistryEntry;
import com.acme.staticforge.urlregistry.UrlRegistryRepository;
import com.acme.staticforge.user.AppUser;
import com.acme.staticforge.user.UserService;
import java.time.Instant;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.data.domain.PageRequest;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.transaction.annotation.Transactional;

/**
 * {@link UrlRegistryRepository} tests (feature url-registry, `M8.2.1`): the unique
 * {@code (projectId, channelKey, pageReferenceUuid, area)} constraint, the filtered/paginated
 * listing query, the scoped-delete methods the reset operation (`M8.2.2`) will use, and the
 * {@code PageReference}-delete cascade-cleanup hook wired into {@code AssetServiceImpl}.
 */
@SpringBootTest
@ActiveProfiles("test")
class UrlRegistryRepositoryTest {

    private static final AtomicInteger SEQ = new AtomicInteger();

    @Autowired UserService userService;
    @Autowired ProjectService projectService;
    @Autowired AssetService assetService;
    @Autowired FolderService folderService;
    @Autowired PageService pageService;
    @Autowired PageReferenceService pageReferenceService;
    @Autowired TemplateService templateService;
    @Autowired UrlRegistryRepository urlRegistryRepository;

    @Test
    void findByTupleRoundTrips() {
        Fixture fx = newFixture();
        UUID pageRefUuid = UUID.randomUUID();
        urlRegistryRepository.save(entry(fx.project().getId(), "html", pageRefUuid, UrlArea.GENERATED, "/about/"));

        UrlRegistryEntry found = urlRegistryRepository
                .findByProjectIdAndChannelKeyAndPageReferenceUuidAndArea(
                        fx.project().getId(), "html", pageRefUuid, UrlArea.GENERATED)
                .orElseThrow();

        assertThat(found.getUrl()).isEqualTo("/about/");
        assertThat(found.getArea()).isEqualTo(UrlArea.GENERATED);
        assertThat(found.isOverridden()).isFalse();

        assertThat(urlRegistryRepository
                        .findByProjectIdAndChannelKeyAndPageReferenceUuidAndArea(
                                fx.project().getId(), "html", pageRefUuid, UrlArea.PREVIEW))
                .isEmpty();
    }

    @Test
    @Transactional
    void uniqueTupleConstraintRejectsADuplicateRow() {
        Fixture fx = newFixture();
        UUID pageRefUuid = UUID.randomUUID();
        urlRegistryRepository.saveAndFlush(entry(fx.project().getId(), "html", pageRefUuid, UrlArea.GENERATED, "/a/"));

        assertThatThrownBy(() -> urlRegistryRepository.saveAndFlush(
                        entry(fx.project().getId(), "html", pageRefUuid, UrlArea.GENERATED, "/a-again/")))
                .isInstanceOf(DataIntegrityViolationException.class);
    }

    @Test
    void previewAndGeneratedAreasAreIndependentForTheSameTuple() {
        Fixture fx = newFixture();
        UUID pageRefUuid = UUID.randomUUID();
        urlRegistryRepository.save(entry(fx.project().getId(), "html", pageRefUuid, UrlArea.PREVIEW, "/preview/about/"));
        urlRegistryRepository.save(entry(fx.project().getId(), "html", pageRefUuid, UrlArea.GENERATED, "/about/"));

        assertThat(urlRegistryRepository
                        .findByProjectIdAndChannelKeyAndPageReferenceUuidAndArea(
                                fx.project().getId(), "html", pageRefUuid, UrlArea.PREVIEW)
                        .orElseThrow()
                        .getUrl())
                .isEqualTo("/preview/about/");
        assertThat(urlRegistryRepository
                        .findByProjectIdAndChannelKeyAndPageReferenceUuidAndArea(
                                fx.project().getId(), "html", pageRefUuid, UrlArea.GENERATED)
                        .orElseThrow()
                        .getUrl())
                .isEqualTo("/about/");
    }

    @Test
    void searchFiltersByChannelAndAreaAndPaginates() {
        Fixture fx = newFixture();
        long projectId = fx.project().getId();
        urlRegistryRepository.save(entry(projectId, "html", UUID.randomUUID(), UrlArea.GENERATED, "/1/"));
        urlRegistryRepository.save(entry(projectId, "html", UUID.randomUUID(), UrlArea.PREVIEW, "/2/"));
        urlRegistryRepository.save(entry(projectId, "markdown", UUID.randomUUID(), UrlArea.GENERATED, "/3/"));

        assertThat(urlRegistryRepository.search(projectId, null, null, PageRequest.of(0, 10)).getTotalElements())
                .isEqualTo(3);
        assertThat(urlRegistryRepository.search(projectId, "html", null, PageRequest.of(0, 10)).getTotalElements())
                .isEqualTo(2);
        assertThat(urlRegistryRepository.search(projectId, null, UrlArea.GENERATED, PageRequest.of(0, 10)).getTotalElements())
                .isEqualTo(2);
        assertThat(urlRegistryRepository.search(projectId, "html", UrlArea.GENERATED, PageRequest.of(0, 10)).getTotalElements())
                .isEqualTo(1);
        assertThat(urlRegistryRepository.search(projectId, null, null, PageRequest.of(0, 2)).getContent())
                .hasSize(2);
    }

    @Test
    @Transactional
    void deleteByProjectIdAndChannelKeyRemovesOnlyThatChannel() {
        Fixture fx = newFixture();
        long projectId = fx.project().getId();
        urlRegistryRepository.save(entry(projectId, "html", UUID.randomUUID(), UrlArea.GENERATED, "/1/"));
        urlRegistryRepository.save(entry(projectId, "markdown", UUID.randomUUID(), UrlArea.GENERATED, "/2/"));

        urlRegistryRepository.deleteByProjectIdAndChannelKey(projectId, "html");

        assertThat(urlRegistryRepository.search(projectId, null, null, PageRequest.of(0, 10)).getTotalElements())
                .isEqualTo(1);
        assertThat(urlRegistryRepository.search(projectId, "markdown", null, PageRequest.of(0, 10)).getTotalElements())
                .isEqualTo(1);
    }

    @Test
    @Transactional
    void deleteByProjectIdRemovesEveryEntryForTheProject() {
        Fixture fx = newFixture();
        long projectId = fx.project().getId();
        urlRegistryRepository.save(entry(projectId, "html", UUID.randomUUID(), UrlArea.GENERATED, "/1/"));
        urlRegistryRepository.save(entry(projectId, "html", UUID.randomUUID(), UrlArea.PREVIEW, "/2/"));

        urlRegistryRepository.deleteByProjectId(projectId);

        assertThat(urlRegistryRepository.search(projectId, null, null, PageRequest.of(0, 10)).getTotalElements())
                .isZero();
    }

    @Test
    void deletingAPageReferenceCascadeDeletesItsRegistryEntriesInBothAreas() {
        Fixture fx = newFixture();
        AssetVersionView navFolder = navRoot(fx);
        AssetVersionView page = createPage(fx, "Home");
        AssetVersionView pageRef = pageReferenceService.create(
                new CreatePageReferenceCommand("Home Link", navFolder.uuid(), PageReferenceTargetKind.PAGE, page.uuid(), null),
                fx.ctx());

        urlRegistryRepository.save(entry(fx.project().getId(), "html", pageRef.uuid(), UrlArea.PREVIEW, "/preview/home/"));
        urlRegistryRepository.save(entry(fx.project().getId(), "html", pageRef.uuid(), UrlArea.GENERATED, "/home/"));

        // A registry entry for an unrelated PageReference must survive the delete below.
        UUID unrelated = UUID.randomUUID();
        urlRegistryRepository.save(entry(fx.project().getId(), "html", unrelated, UrlArea.GENERATED, "/unrelated/"));

        assetService.softDelete(pageRef.uuid(), true, fx.ctx());

        assertThat(urlRegistryRepository
                        .findByProjectIdAndChannelKeyAndPageReferenceUuidAndArea(
                                fx.project().getId(), "html", pageRef.uuid(), UrlArea.PREVIEW))
                .isEmpty();
        assertThat(urlRegistryRepository
                        .findByProjectIdAndChannelKeyAndPageReferenceUuidAndArea(
                                fx.project().getId(), "html", pageRef.uuid(), UrlArea.GENERATED))
                .isEmpty();
        assertThat(urlRegistryRepository
                        .findByProjectIdAndChannelKeyAndPageReferenceUuidAndArea(
                                fx.project().getId(), "html", unrelated, UrlArea.GENERATED))
                .isPresent();
    }

    private static UrlRegistryEntry entry(long projectId, String channelKey, UUID pageRefUuid, UrlArea area, String url) {
        return new UrlRegistryEntry(projectId, channelKey, pageRefUuid, area, url, Instant.now(), 1L, false);
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
                        null),
                fx.ctx());
        return pageService.create(new CreatePageCommand(name, null, pageTemplate.uuid()), fx.ctx());
    }

    private Fixture newFixture() {
        int n = SEQ.incrementAndGet();
        AppUser user = userService.create("urlreg-user-" + n, "urlreg-user-" + n + "@example.com", "UrlReg User " + n, "secret-password");
        Project project = projectService.create(
                new CreateProjectRequest("urlregp_" + n, "UrlReg Project " + n, null, null), user.getId());
        return new Fixture(project, user);
    }

    private record Fixture(Project project, AppUser user) {
        RevisionContext ctx() {
            return RevisionContext.of(project().getId(), user().getId(), "test");
        }
    }
}
