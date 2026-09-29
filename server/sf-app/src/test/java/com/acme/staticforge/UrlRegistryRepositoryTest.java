package com.acme.staticforge;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.acme.staticforge.asset.AssetService;
import com.acme.staticforge.asset.AssetType;
import com.acme.staticforge.asset.AssetVersionView;
import com.acme.staticforge.asset.folder.FolderScope;
import com.acme.staticforge.asset.folder.FolderService;
import com.acme.staticforge.asset.navigation.PageReferenceService;
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
import com.acme.staticforge.urlregistry.UrlTarget;
import com.acme.staticforge.urlregistry.UrlTargetType;
import com.acme.staticforge.user.AppUser;
import com.acme.staticforge.user.UserService;
import java.time.Instant;
import java.util.List;
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
 * {@link UrlRegistryRepository} tests (feature url-registry, `M8.2.1`; every target since M32.1): the unique tuple
 * {@code (projectId, channelKey, area, localeKey, targetType, targetUuid, variantKey, pageNumber)}, one URL per
 * target, the insert-if-absent that loses to either, the filtered listing and the scoped deletes, and the cleanup of a
 * deleted asset's computed preview rows wired into {@code AssetServiceImpl}.
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
        UUID page = UUID.randomUUID();
        urlRegistryRepository.save(entry(fx.project().getId(), "html", UrlTarget.page(page), UrlArea.GENERATED, "about/"));

        UrlRegistryEntry found = find(fx, "html", UrlTarget.page(page), UrlArea.GENERATED).orElseThrow();

        assertThat(found.getUrl()).isEqualTo("about/");
        assertThat(found.target()).isEqualTo(UrlTarget.page(page));
        assertThat(found.isOverridden()).isFalse();
        assertThat(find(fx, "html", UrlTarget.page(page), UrlArea.PREVIEW)).isEmpty();
        assertThat(find(fx, "html", UrlTarget.page(page, 2), UrlArea.GENERATED)).isEmpty();
    }

    @Test
    @Transactional
    void uniqueTupleConstraintRejectsADuplicateRow() {
        Fixture fx = newFixture();
        UUID page = UUID.randomUUID();
        urlRegistryRepository.saveAndFlush(entry(fx.project().getId(), "html", UrlTarget.page(page), UrlArea.GENERATED, "a/"));

        assertThatThrownBy(() -> urlRegistryRepository.saveAndFlush(
                        entry(fx.project().getId(), "html", UrlTarget.page(page), UrlArea.GENERATED, "a-again/")))
                .isInstanceOf(DataIntegrityViolationException.class);
    }

    @Test
    @Transactional
    void oneUrlBelongsToOneTargetPerChannelAreaAndLanguage() {
        Fixture fx = newFixture();
        long projectId = fx.project().getId();
        urlRegistryRepository.saveAndFlush(entry(projectId, "html", UrlTarget.page(UUID.randomUUID()), UrlArea.GENERATED, "a.html"));

        assertThatThrownBy(() -> urlRegistryRepository.saveAndFlush(
                        entry(projectId, "html", UrlTarget.page(UUID.randomUUID()), UrlArea.GENERATED, "a.html")))
                .isInstanceOf(DataIntegrityViolationException.class);
    }

    @Test
    @Transactional
    void insertIfAbsentLosesQuietlyToATakenTupleOrUrl() {
        Fixture fx = newFixture();
        long projectId = fx.project().getId();
        UUID a = UUID.randomUUID();
        UUID b = UUID.randomUUID();

        assertThat(insert(projectId, UrlTarget.page(a), "a.html")).isEqualTo(1);
        assertThat(insert(projectId, UrlTarget.page(a), "other.html")).as("tuple taken").isZero();
        assertThat(insert(projectId, UrlTarget.page(b), "a.html")).as("URL taken").isZero();
        assertThat(insert(projectId, UrlTarget.page(b, 2), "b-2.html")).isEqualTo(1);
    }

    @Test
    void mediaRowsAreChannelIndependentAndKeyedByVariant() {
        Fixture fx = newFixture();
        UUID media = UUID.randomUUID();
        urlRegistryRepository.save(entry(fx.project().getId(), "html", UrlTarget.media(media, null), UrlArea.GENERATED,
                "assets/media/logo.png"));
        urlRegistryRepository.save(entry(fx.project().getId(), "html", UrlTarget.media(media, "thumb"), UrlArea.GENERATED,
                "assets/media/logo-thumb.jpg"));

        assertThat(find(fx, "", UrlTarget.media(media, null), UrlArea.GENERATED)).get()
                .extracting(UrlRegistryEntry::getChannelKey).isEqualTo("");
        assertThat(find(fx, "", UrlTarget.media(media, "thumb"), UrlArea.GENERATED)).get()
                .extracting(UrlRegistryEntry::getUrl).isEqualTo("assets/media/logo-thumb.jpg");
    }

    @Test
    void searchFiltersAndPaginates() {
        Fixture fx = newFixture();
        long projectId = fx.project().getId();
        UUID page = UUID.randomUUID();
        urlRegistryRepository.save(entry(projectId, "html", UrlTarget.page(page), UrlArea.GENERATED, "one.html"));
        urlRegistryRepository.save(entry(projectId, "html", UrlTarget.page(UUID.randomUUID()), UrlArea.PREVIEW, "two.html"));
        urlRegistryRepository.save(entry(projectId, "markdown", UrlTarget.page(UUID.randomUUID()), UrlArea.GENERATED, "three.md"));
        urlRegistryRepository.save(entry(projectId, "", UrlTarget.media(UUID.randomUUID(), null), UrlArea.GENERATED, "x.png"));

        assertThat(search(projectId, null, null, null, null, null).getTotalElements()).isEqualTo(4);
        assertThat(search(projectId, "html", null, null, null, null).getTotalElements()).isEqualTo(2);
        assertThat(search(projectId, null, UrlArea.GENERATED, null, null, null).getTotalElements()).isEqualTo(3);
        assertThat(search(projectId, null, null, UrlTargetType.MEDIA, null, null).getTotalElements()).isEqualTo(1);
        assertThat(search(projectId, null, null, null, page, null).getTotalElements()).isEqualTo(1);
        assertThat(search(projectId, null, null, null, null, "%thr%").getTotalElements()).isEqualTo(1);
        assertThat(urlRegistryRepository.search(projectId, null, null, null, null, null, null, true,
                        List.of(UUID.randomUUID()), PageRequest.of(0, 2)).getContent())
                .hasSize(2);
    }

    @Test
    @Transactional
    void deleteByProjectIdAndChannelKeyRemovesOnlyThatChannel() {
        Fixture fx = newFixture();
        long projectId = fx.project().getId();
        urlRegistryRepository.save(entry(projectId, "html", UrlTarget.page(UUID.randomUUID()), UrlArea.GENERATED, "1.html"));
        urlRegistryRepository.save(entry(projectId, "markdown", UrlTarget.page(UUID.randomUUID()), UrlArea.GENERATED, "2.md"));

        urlRegistryRepository.deleteByProjectIdAndChannelKey(projectId, "html");

        assertThat(search(projectId, null, null, null, null, null).getTotalElements()).isEqualTo(1);
        assertThat(search(projectId, "markdown", null, null, null, null).getTotalElements()).isEqualTo(1);
    }

    @Test
    @Transactional
    void deleteByProjectIdRemovesEveryEntryForTheProject() {
        Fixture fx = newFixture();
        long projectId = fx.project().getId();
        urlRegistryRepository.save(entry(projectId, "html", UrlTarget.page(UUID.randomUUID()), UrlArea.GENERATED, "1.html"));
        urlRegistryRepository.save(entry(projectId, "html", UrlTarget.page(UUID.randomUUID()), UrlArea.PREVIEW, "2.html"));

        urlRegistryRepository.deleteByProjectId(projectId);

        assertThat(search(projectId, null, null, null, null, null).getTotalElements()).isZero();
    }

    @Test
    void deletingAPageDropsItsComputedPreviewRowsAndKeepsOverridesAndGeneratedRows() {
        Fixture fx = newFixture();
        long projectId = fx.project().getId();
        AssetVersionView page = createPage(fx, "Home");
        AssetVersionView other = createPage(fx, "Other");

        urlRegistryRepository.save(entry(projectId, "html", UrlTarget.page(page.uuid()), UrlArea.PREVIEW, "home.html"));
        urlRegistryRepository.save(entry(projectId, "amp", UrlTarget.page(page.uuid()), UrlArea.PREVIEW, "home.amp.html", true));
        urlRegistryRepository.save(entry(projectId, "html", UrlTarget.page(page.uuid()), UrlArea.GENERATED, "home.html"));
        urlRegistryRepository.save(entry(projectId, "html", UrlTarget.page(other.uuid()), UrlArea.PREVIEW, "other.html"));

        assetService.softDelete(page.uuid(), true, fx.ctx());

        assertThat(find(fx, "html", UrlTarget.page(page.uuid()), UrlArea.PREVIEW)).as("computed preview row").isEmpty();
        assertThat(find(fx, "amp", UrlTarget.page(page.uuid()), UrlArea.PREVIEW)).as("override").isPresent();
        assertThat(find(fx, "html", UrlTarget.page(page.uuid()), UrlArea.GENERATED))
                .as("a build drops generated rows once the deletion is published").isPresent();
        assertThat(find(fx, "html", UrlTarget.page(other.uuid()), UrlArea.PREVIEW)).isPresent();
    }

    private java.util.Optional<UrlRegistryEntry> find(Fixture fx, String channel, UrlTarget target, UrlArea area) {
        return urlRegistryRepository.findTuple(fx.project().getId(), channel, area, "", target.type(), target.uuid(),
                target.variant(), target.pageNumber());
    }

    private int insert(long projectId, UrlTarget target, String url) {
        return urlRegistryRepository.insertIfAbsent(projectId, "html", "GENERATED", "", target.type().name(),
                target.uuid(), target.variant(), target.pageNumber(), url, Instant.now(), 1L, false);
    }

    private org.springframework.data.domain.Page<UrlRegistryEntry> search(
            long projectId, String channel, UrlArea area, UrlTargetType type, UUID target, String urlLike) {
        return urlRegistryRepository.search(projectId, channel, area, type, null, target, urlLike, true,
                List.of(UUID.randomUUID()), PageRequest.of(0, 10));
    }

    private static UrlRegistryEntry entry(long projectId, String channelKey, UrlTarget target, UrlArea area, String url) {
        return entry(projectId, channelKey, target, area, url, false);
    }

    private static UrlRegistryEntry entry(
            long projectId, String channelKey, UrlTarget target, UrlArea area, String url, boolean overridden) {
        return new UrlRegistryEntry(projectId, channelKey, target, area, "", url, Instant.now(), 1L, overridden);
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
