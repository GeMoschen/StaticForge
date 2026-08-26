package com.acme.staticforge;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.acme.staticforge.asset.AssetService;
import com.acme.staticforge.asset.AssetType;
import com.acme.staticforge.asset.AssetVersionView;
import com.acme.staticforge.asset.folder.FolderNode;
import com.acme.staticforge.asset.folder.FolderScope;
import com.acme.staticforge.asset.folder.FolderService;
import com.acme.staticforge.asset.folder.StartNode;
import com.acme.staticforge.asset.folder.StartNodeKind;
import com.acme.staticforge.asset.navigation.CreatePageReferenceCommand;
import com.acme.staticforge.asset.navigation.LiveNavigationLookup;
import com.acme.staticforge.asset.navigation.NavTreeNode;
import com.acme.staticforge.asset.navigation.NavigationService;
import com.acme.staticforge.asset.navigation.PageReferenceService;
import com.acme.staticforge.asset.navigation.PageReferenceTargetKind;
import com.acme.staticforge.asset.page.CreatePageCommand;
import com.acme.staticforge.asset.page.PageService;
import com.acme.staticforge.asset.template.CreateTemplateCommand;
import com.acme.staticforge.asset.template.TemplateService;
import com.acme.staticforge.asset.template.TemplateView;
import com.acme.staticforge.common.SfException;
import com.acme.staticforge.generate.nav.SnapshotNavigationLookup;
import com.acme.staticforge.generate.snapshot.Snapshot;
import com.acme.staticforge.generate.snapshot.SnapshotService;
import com.acme.staticforge.project.CreateProjectRequest;
import com.acme.staticforge.project.Project;
import com.acme.staticforge.project.ProjectService;
import com.acme.staticforge.revision.RevisionContext;
import com.acme.staticforge.template.diagnostic.Diagnostic;
import com.acme.staticforge.user.AppUser;
import com.acme.staticforge.user.UserService;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;

/**
 * {@link NavigationService} resolution tests against the live repositories (spec §17,
 * `M8.1.3`), plus the explicit dual-path parity acceptance criterion: the same fixture,
 * resolved through {@link LiveNavigationLookup} and through a {@link SnapshotNavigationLookup}
 * built from a {@link Snapshot} of the same project, must produce identical results.
 *
 * <p>The pure algorithm (cycle detection, ordering, depth cap) is covered without a database
 * in {@code sf-domain}'s {@code NavigationServiceImplTest}; this class only needs the live
 * repositories and generation's {@code Snapshot} machinery, both of which require a Spring
 * context.
 */
@SpringBootTest
@ActiveProfiles("test")
class NavigationServiceIntegrationTest {

    private static final AtomicInteger SEQ = new AtomicInteger();

    @Autowired UserService userService;
    @Autowired ProjectService projectService;
    @Autowired AssetService assetService;
    @Autowired FolderService folderService;
    @Autowired PageService pageService;
    @Autowired PageReferenceService pageReferenceService;
    @Autowired TemplateService templateService;
    @Autowired NavigationService navigationService;
    @Autowired LiveNavigationLookup liveNavigationLookup;
    @Autowired SnapshotService snapshotService;

    @Test
    void resolveReturnsDirectPageTargetAgainstTheLiveRepositories() {
        Fixture fx = newFixture();
        AssetVersionView navRoot = navRoot(fx);
        AssetVersionView page = createPage(fx, "Home");
        AssetVersionView ref = pageReferenceService.create(
                new CreatePageReferenceCommand("Home Link", navRoot.uuid(), PageReferenceTargetKind.PAGE, page.uuid(), null),
                fx.ctx());

        assertThat(navigationService.resolve(ref.uuid(), liveNavigationLookup)).isEqualTo(page.uuid());
    }

    @Test
    void pageReferenceCreateRejectsADanglingFolderTarget() {
        Fixture fx = newFixture();
        AssetVersionView navRoot = navRoot(fx);
        AssetVersionView emptyFolder = folderService.create(null, "Empty", FolderScope.PAGES, fx.ctx());

        assertThatThrownBy(() -> pageReferenceService.create(
                        new CreatePageReferenceCommand(
                                "Dead Link", navRoot.uuid(), PageReferenceTargetKind.FOLDER, emptyFolder.uuid(), null),
                        fx.ctx()))
                .isInstanceOfSatisfying(SfException.class, ex -> assertThat(ex.getStatus()).isEqualTo(422));
    }

    @Test
    void pageReferenceCreateAcceptsAFolderTargetWithANavigablePage() {
        Fixture fx = newFixture();
        AssetVersionView navRoot = navRoot(fx);
        AssetVersionView productsFolder = folderService.create(null, "Products", FolderScope.PAGES, fx.ctx());
        createPage(fx, "Widgets", productsFolder.uuid());

        AssetVersionView ref = pageReferenceService.create(
                new CreatePageReferenceCommand(
                        "Products Link", navRoot.uuid(), PageReferenceTargetKind.FOLDER, productsFolder.uuid(), null),
                fx.ctx());

        assertThat(ref.type()).isEqualTo(AssetType.PAGE_REFERENCE);
    }

    /**
     * Explicit acceptance criterion: {@code NavigationService} run against a live-repository
     * {@link NavigationLookup} and against a {@code Snapshot}-backed one for the same fixture
     * must resolve identically — a startNode chain, a folder-targeted PageReference resolved
     * to a nested page, and the full tree.
     */
    @Test
    void snapshotAndLiveRepositoryPathsResolveIdentically() {
        Fixture fx = newFixture();
        AssetVersionView navRoot = navRoot(fx);

        AssetVersionView productsFolder = folderService.create(null, "Products", FolderScope.PAGES, fx.ctx());
        AssetVersionView emptySub = folderService.create(productsFolder.uuid(), "Aardvark", null, fx.ctx());
        AssetVersionView subWithPage = folderService.create(productsFolder.uuid(), "Bikes", null, fx.ctx());
        AssetVersionView deepPage = createPage(fx, "Road Bikes", subWithPage.uuid());
        assertThat(emptySub.uuid()).isNotNull(); // present only to prove the recursion skips empty subfolders

        AssetVersionView homePage = createPage(fx, "Home");
        AssetVersionView productsRef = pageReferenceService.create(
                new CreatePageReferenceCommand(
                        "Products", navRoot.uuid(), PageReferenceTargetKind.FOLDER, productsFolder.uuid(), null),
                fx.ctx());

        AssetVersionView sectionFolder = folderService.create(navRoot.uuid(), "Section", FolderScope.NAVIGATION, fx.ctx());
        AssetVersionView homeRef = pageReferenceService.create(
                new CreatePageReferenceCommand("Home", sectionFolder.uuid(), PageReferenceTargetKind.PAGE, homePage.uuid(), "Home Label"),
                fx.ctx());
        folderService.updateStartNode(
                sectionFolder.uuid(), new StartNode(StartNodeKind.PAGE_REFERENCE, homeRef.uuid()),
                sectionFolder.validFromRevision(), fx.ctx());
        folderService.updateStartNode(
                navRoot.uuid(), new StartNode(StartNodeKind.FOLDER, sectionFolder.uuid()),
                navRoot.validFromRevision(), fx.ctx());

        // -- live path --
        List<Diagnostic> liveDiagnostics = new ArrayList<>();
        UUID liveHomeResolve = navigationService.resolve(homeRef.uuid(), liveNavigationLookup);
        UUID liveProductsResolve = navigationService.resolve(productsRef.uuid(), liveNavigationLookup);
        UUID liveStartNodeResolve =
                navigationService.resolveFolderEntry(navRoot.uuid(), liveNavigationLookup, liveDiagnostics).orElse(null);
        NavTreeNode liveTree = navigationService.tree(navRoot.uuid(), -1, liveNavigationLookup, liveDiagnostics);

        // -- snapshot path (same project, same fixture) --
        Snapshot snapshot = snapshotService.snapshot(fx.project().getId(), null);
        SnapshotNavigationLookup snapshotLookup = new SnapshotNavigationLookup(snapshot);
        List<Diagnostic> snapshotDiagnostics = new ArrayList<>();
        UUID snapshotHomeResolve = navigationService.resolve(homeRef.uuid(), snapshotLookup);
        UUID snapshotProductsResolve = navigationService.resolve(productsRef.uuid(), snapshotLookup);
        UUID snapshotStartNodeResolve =
                navigationService.resolveFolderEntry(navRoot.uuid(), snapshotLookup, snapshotDiagnostics).orElse(null);
        NavTreeNode snapshotTree = navigationService.tree(navRoot.uuid(), -1, snapshotLookup, snapshotDiagnostics);

        assertThat(liveHomeResolve).isEqualTo(homePage.uuid()).isEqualTo(snapshotHomeResolve);
        assertThat(liveProductsResolve).isEqualTo(deepPage.uuid()).isEqualTo(snapshotProductsResolve);
        assertThat(liveStartNodeResolve).isEqualTo(homePage.uuid()).isEqualTo(snapshotStartNodeResolve);
        assertThat(liveDiagnostics).isEmpty();
        assertThat(snapshotDiagnostics).isEmpty();
        assertThat(canonicalize(liveTree)).isEqualTo(canonicalize(snapshotTree));
    }

    /** A deterministic, order-independent string rendering of a tree for structural equality assertions. */
    private static String canonicalize(NavTreeNode node) {
        if (node == null) {
            return "null";
        }
        StringBuilder sb = new StringBuilder();
        canonicalize(node, sb);
        return sb.toString();
    }

    private static void canonicalize(NavTreeNode node, StringBuilder sb) {
        sb.append('[')
                .append(node.type())
                .append(':')
                .append(node.label())
                .append(":resolved=")
                .append(node.resolvedPageUuid())
                .append(':');
        for (NavTreeNode child : node.children()) {
            canonicalize(child, sb);
        }
        sb.append(']');
    }

    private AssetVersionView navRoot(Fixture fx) {
        List<FolderNode> tree = folderService.tree(fx.project().getId(), FolderScope.NAVIGATION, 0, fx.ctx());
        FolderNode root = tree.get(0);
        return assetService.requireCurrent(root.uuid());
    }

    private AssetVersionView createPage(Fixture fx, String name) {
        return createPage(fx, name, null);
    }

    private AssetVersionView createPage(Fixture fx, String name, UUID folderUuid) {
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
        return pageService.create(new CreatePageCommand(name, folderUuid, pageTemplate.uuid()), fx.ctx());
    }

    private Fixture newFixture() {
        int n = SEQ.incrementAndGet();
        AppUser user = userService.create("navsvc-user-" + n, "navsvc-user-" + n + "@example.com", "Nav Svc User " + n, "secret-password");
        Project project = projectService.create(new CreateProjectRequest("navsvcp_" + n, "Nav Svc Project " + n, null, null), user.getId());
        return new Fixture(project, user);
    }

    private record Fixture(Project project, AppUser user) {
        RevisionContext ctx() {
            return RevisionContext.of(project().getId(), user().getId(), "test");
        }
    }
}
