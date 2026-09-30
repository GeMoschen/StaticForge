package com.acme.staticforge;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.acme.staticforge.asset.AssetType;
import com.acme.staticforge.asset.AssetVersionView;
import com.acme.staticforge.asset.folder.FolderNode;
import com.acme.staticforge.asset.folder.FolderScope;
import com.acme.staticforge.asset.folder.FolderService;
import com.acme.staticforge.asset.folder.StartNode;
import com.acme.staticforge.asset.folder.StartNodeKind;
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
import com.acme.staticforge.user.AppUser;
import com.acme.staticforge.user.UserService;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;

/**
 * Navigation domain model tests (spec §17, `M8.1.2`): top-level `NAVIGATION` folder creation,
 * {@code PageReference} target validation, and folder {@code startNode} validation.
 * Resolution/rendering (`M8.1.3`+) is explicitly out of scope here.
 */
@SpringBootTest
@ActiveProfiles("test")
class NavigationDomainIntegrationTest {

    private static final AtomicInteger SEQ = new AtomicInteger();

    @Autowired UserService userService;
    @Autowired ProjectService projectService;
    @Autowired FolderService folderService;
    @Autowired PageService pageService;
    @Autowired PageReferenceService pageReferenceService;
    @Autowired TemplateService templateService;

    @Test
    void navigationStoreProvisionsExactlyTheFixedRootOnProjectCreate() {
        Fixture fx = newFixture();

        List<FolderNode> tree = folderService.tree(fx.project().getId(), FolderScope.NAVIGATION, -1, fx.ctx());

        assertThat(tree).hasSize(1);
        assertThat(tree.get(0).uid()).isEqualTo(FolderScope.NAVIGATION_ROOT_UID);
        assertThat(tree.get(0).protectedFolder()).isTrue();
        assertThat(tree.get(0).children()).isEmpty();
    }

    @Test
    void topLevelNavigationFolderNestsUnderTheFixedRoot() {
        Fixture fx = newFixture();

        AssetVersionView created = folderService.create(null, "Main Menu", FolderScope.NAVIGATION, fx.ctx());

        List<FolderNode> tree = folderService.tree(fx.project().getId(), FolderScope.NAVIGATION, -1, fx.ctx());
        assertThat(tree).hasSize(1);
        FolderNode root = tree.get(0);
        assertThat(root.uid()).isEqualTo(FolderScope.NAVIGATION_ROOT_UID);
        assertThat(root.children()).hasSize(1);
        assertThat(root.children().get(0).uuid()).isEqualTo(created.uuid());
        assertThat(root.children().get(0).displayName()).isEqualTo("Main Menu");
        assertThat(root.children().get(0).scope()).isEqualTo(FolderScope.NAVIGATION);
    }

    @Test
    void pageReferenceRoundTripsThroughAssetServiceAndDefaultsLabelToNull() {
        Fixture fx = newFixture();
        AssetVersionView navFolder = navRoot(fx);
        AssetVersionView page = createPage(fx, "Home");

        AssetVersionView created = pageReferenceService.create(
                new CreatePageReferenceCommand("Home Link", navFolder.uuid(), PageReferenceTargetKind.PAGE, page.uuid(), null),
                fx.ctx());

        assertThat(created.type()).isEqualTo(AssetType.PAGE_REFERENCE);
        assertThat(created.payload().path("target").path("kind").asText()).isEqualTo("PAGE");
        assertThat(created.payload().path("target").path("assetUuid").asText()).isEqualTo(page.uuid().toString());
        assertThat(created.payload().path("label").isNull()).isTrue();

        AssetVersionView updated = pageReferenceService.update(
                created.uuid(), PageReferenceTargetKind.PAGE, page.uuid(), "Overridden Label",
                created.validFromRevision(), fx.ctx());

        assertThat(updated.payload().path("label").asText()).isEqualTo("Overridden Label");
    }

    @Test
    void pageReferenceCreateRejectsDanglingTarget() {
        Fixture fx = newFixture();
        AssetVersionView navFolder = navRoot(fx);

        assertThatThrownBy(() -> pageReferenceService.create(
                        new CreatePageReferenceCommand(
                                "Broken", navFolder.uuid(), PageReferenceTargetKind.PAGE, UUID.randomUUID(), null),
                        fx.ctx()))
                .isInstanceOfSatisfying(SfException.class, ex -> assertThat(ex.getStatus()).isEqualTo(422));
    }

    @Test
    void pageReferenceCreateRejectsTargetOfTheWrongKind() {
        Fixture fx = newFixture();
        AssetVersionView navFolder = navRoot(fx);
        AssetVersionView pagesFolder = folderService.create(null, "Products", FolderScope.PAGES, fx.ctx());
        AssetVersionView page = createPage(fx, "About");

        // Declared PAGE but the target is actually a Folder.
        assertThatThrownBy(() -> pageReferenceService.create(
                        new CreatePageReferenceCommand(
                                "Wrong Kind", navFolder.uuid(), PageReferenceTargetKind.PAGE, pagesFolder.uuid(), null),
                        fx.ctx()))
                .isInstanceOfSatisfying(SfException.class, ex -> assertThat(ex.getStatus()).isEqualTo(422));

        // Declared FOLDER but the target is a Page, not a Folder.
        assertThatThrownBy(() -> pageReferenceService.create(
                        new CreatePageReferenceCommand(
                                "Wrong Kind 2", navFolder.uuid(), PageReferenceTargetKind.FOLDER, page.uuid(), null),
                        fx.ctx()))
                .isInstanceOfSatisfying(SfException.class, ex -> assertThat(ex.getStatus()).isEqualTo(422));

        // Declared FOLDER but the target folder is a navigation folder, not a page-store folder.
        assertThatThrownBy(() -> pageReferenceService.create(
                        new CreatePageReferenceCommand(
                                "Wrong Kind 3", navFolder.uuid(), PageReferenceTargetKind.FOLDER, navFolder.uuid(), null),
                        fx.ctx()))
                .isInstanceOfSatisfying(SfException.class, ex -> assertThat(ex.getStatus()).isEqualTo(422));
    }

    @Test
    void folderStartNodeAcceptsAndClearsADirectChild() {
        Fixture fx = newFixture();
        AssetVersionView navFolder = navRoot(fx);
        AssetVersionView page = createPage(fx, "Home");
        AssetVersionView pageRef = pageReferenceService.create(
                new CreatePageReferenceCommand("Home Link", navFolder.uuid(), PageReferenceTargetKind.PAGE, page.uuid(), null),
                fx.ctx());

        AssetVersionView withStartNode = folderService.updateStartNode(
                navFolder.uuid(), new StartNode(StartNodeKind.PAGE_REFERENCE, pageRef.uuid()),
                navFolder.validFromRevision(), fx.ctx());

        assertThat(withStartNode.payload().path("startNode").path("kind").asText()).isEqualTo("PAGE_REFERENCE");
        assertThat(withStartNode.payload().path("startNode").path("assetUuid").asText()).isEqualTo(pageRef.uuid().toString());

        AssetVersionView cleared = folderService.updateStartNode(
                navFolder.uuid(), null, withStartNode.validFromRevision(), fx.ctx());

        assertThat(cleared.payload().path("startNode").isNull()).isTrue();
    }

    @Test
    void folderStartNodeRejectsANodeOutsideDirectChildren() {
        Fixture fx = newFixture();
        AssetVersionView navRoot = navRoot(fx);
        AssetVersionView folderA = folderService.create(navRoot.uuid(), "Section A", null, fx.ctx());
        AssetVersionView folderB = folderService.create(navRoot.uuid(), "Section B", null, fx.ctx());
        AssetVersionView page = createPage(fx, "Home");
        AssetVersionView pageRefUnderB = pageReferenceService.create(
                new CreatePageReferenceCommand("Home Link", folderB.uuid(), PageReferenceTargetKind.PAGE, page.uuid(), null),
                fx.ctx());

        assertThatThrownBy(() -> folderService.updateStartNode(
                        folderA.uuid(), new StartNode(StartNodeKind.PAGE_REFERENCE, pageRefUnderB.uuid()),
                        folderA.validFromRevision(), fx.ctx()))
                .isInstanceOfSatisfying(SfException.class, ex -> assertThat(ex.getStatus()).isEqualTo(422));
    }

    @Test
    void folderStartNodeRejectsOnANonNavigationFolder() {
        Fixture fx = newFixture();
        AssetVersionView pagesFolder = folderService.create(null, "Products", FolderScope.PAGES, fx.ctx());

        assertThatThrownBy(() -> folderService.updateStartNode(
                        pagesFolder.uuid(), null, pagesFolder.validFromRevision(), fx.ctx()))
                .isInstanceOfSatisfying(SfException.class, ex -> assertThat(ex.getStatus()).isEqualTo(422));
    }

    /** A fresh top-level `NAVIGATION` folder for a test to nest its own content under — nothing
     * is pre-provisioned any more, so each test that needs one creates its own. */
    private AssetVersionView navRoot(Fixture fx) {
        return folderService.create(null, "Nav Root " + SEQ.incrementAndGet(), FolderScope.NAVIGATION, fx.ctx());
    }

    private AssetVersionView createPage(Fixture fx, String name) {
        TemplateView pageTemplate = templateService.create(
                new CreateTemplateCommand(
                        fx.project().getId(),
                        AssetType.PAGE_TEMPLATE,
                        name + " Template " + SEQ.incrementAndGet(),
                        CdlSources.split("content { editor text title { required } }"),
                        Map.of("html", "<h1>$CMS_VALUE(title)$</h1>"),
                        null,
                        false,
                        null),
                fx.ctx());
        return pageService.create(new CreatePageCommand(name, null, pageTemplate.uuid()), fx.ctx());
    }

    private Fixture newFixture() {
        int n = SEQ.incrementAndGet();
        AppUser user = userService.create("nav-user-" + n, "nav-user-" + n + "@example.com", "Nav User " + n, "secret-password");
        Project project = projectService.create(new CreateProjectRequest("navp_" + n, "Nav Project " + n, null, null), user.getId());
        return new Fixture(project, user);
    }

    private record Fixture(Project project, AppUser user) {
        RevisionContext ctx() {
            return RevisionContext.of(project().getId(), user().getId(), "test");
        }
    }
}
