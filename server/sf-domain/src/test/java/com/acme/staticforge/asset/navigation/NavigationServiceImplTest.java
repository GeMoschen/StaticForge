package com.acme.staticforge.asset.navigation;

import static org.assertj.core.api.Assertions.assertThat;

import com.acme.staticforge.asset.folder.PathService;
import com.acme.staticforge.template.diagnostic.Diagnostic;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.Test;

/**
 * Pure algorithm-level tests for {@link NavigationServiceImpl} (spec §17, `M8.1.3`), run
 * entirely against an in-memory {@link FakeNavigationLookup} — no Spring context, no database.
 * The dual-path parity acceptance criterion (identical results against a {@code Snapshot} or
 * the live repositories) is covered separately, in
 * {@code sf-app}'s {@code NavigationServiceParityIntegrationTest}, where both a live DB fixture
 * and a {@code Snapshot} are actually available.
 */
class NavigationServiceImplTest {

    private final NavigationService service = new NavigationServiceImpl();

    @Test
    void resolveReturnsDirectPageTargetImmediately() {
        FakeNavigationLookup lookup = new FakeNavigationLookup();
        UUID navRoot = lookup.addFolder(null, "Navigation");
        UUID page = lookup.addPage(null, "Home", 0);
        UUID ref = lookup.addPageReferenceToPage(navRoot, "Home Link", page, null);

        assertThat(service.resolve(1L, ref, lookup)).isEqualTo(page);
    }

    @Test
    void resolveFolderTargetReturnsFirstDirectChildPageInDeterministicOrder() {
        FakeNavigationLookup lookup = new FakeNavigationLookup();
        UUID navRoot = lookup.addFolder(null, "Navigation");
        UUID pagesFolder = lookup.addFolder(null, "Products");
        lookup.addPage(pagesFolder, "Zebra", 5);
        UUID first = lookup.addPage(pagesFolder, "Alpha", 1); // lowest nav.position wins, regardless of displayName
        lookup.addPage(pagesFolder, "Beta", 5);
        UUID ref = lookup.addPageReferenceToFolder(navRoot, "Products Link", pagesFolder, null);

        assertThat(service.resolve(1L, ref, lookup)).isEqualTo(first);
    }

    @Test
    void resolveFolderTargetRecursesIntoSubfoldersWhenNoDirectPages() {
        FakeNavigationLookup lookup = new FakeNavigationLookup();
        UUID navRoot = lookup.addFolder(null, "Navigation");
        UUID pagesFolder = lookup.addFolder(null, "Products");
        UUID emptySubA = lookup.addFolder(pagesFolder, "Aardvark"); // no pages: recursion must skip past it
        UUID subB = lookup.addFolder(pagesFolder, "Bikes");
        UUID deepPage = lookup.addPage(subB, "Road Bikes", 0);
        UUID ref = lookup.addPageReferenceToFolder(navRoot, "Products Link", pagesFolder, null);

        assertThat(service.resolve(1L, ref, lookup)).isEqualTo(deepPage);
        assertThat(service.firstNavigablePage(1L, emptySubA, lookup)).isEmpty();
    }

    @Test
    void theChannelsIndexUidPageIsTheIndexPage() {
        FakeNavigationLookup lookup = new FakeNavigationLookup();
        UUID navRoot = lookup.addFolder(null, "Navigation");
        UUID pagesFolder = lookup.addFolder(null, "Products");
        UUID first = lookup.addPage(pagesFolder, "Alpha", 1);
        UUID home = lookup.addPageWithUid(pagesFolder, "home", "Products home", 9);
        UUID ref = lookup.addPageReferenceToFolder(navRoot, "Products Link", pagesFolder, null);

        assertThat(service.resolve(1L, ref, lookup.withIndexUid("home"))).isEqualTo(home);
        assertThat(service.indexPage(1L, pagesFolder, lookup.withIndexUid("home"))).contains(home);
        // A lookup serving no single channel knows no index page.
        assertThat(service.resolve(1L, ref, lookup)).isEqualTo(first);
        assertThat(service.indexPage(1L, pagesFolder, lookup)).isEmpty();
        // Re-wrapping replaces the channel instead of stacking.
        assertThat(lookup.withIndexUid("home").withIndexUid("other").indexUid()).isEqualTo("other");
    }

    @Test
    void theSubfolderWalkPrefersEachFoldersIndexPage() {
        FakeNavigationLookup lookup = new FakeNavigationLookup();
        UUID navRoot = lookup.addFolder(null, "Navigation");
        UUID pagesFolder = lookup.addFolder(null, "Products");
        UUID bikes = lookup.addFolder(pagesFolder, "Bikes");
        lookup.addPage(bikes, "Road Bikes", 0);
        UUID bikesIndex = lookup.addPageWithUid(bikes, "home", "All bikes", 5);
        UUID ref = lookup.addPageReferenceToFolder(navRoot, "Products Link", pagesFolder, null);

        assertThat(service.resolve(1L, ref, lookup.withIndexUid("home"))).isEqualTo(bikesIndex);
        assertThat(service.firstNavigablePage(1L, pagesFolder, lookup.withIndexUid("home"))).contains(bikesIndex);
    }

    @Test
    void onlyAFolderHasAnIndexPage() {
        FakeNavigationLookup lookup = new FakeNavigationLookup();
        UUID folder = lookup.addFolder(null, "Products");
        UUID page = lookup.addPageWithUid(folder, "home", "Overview", 0);
        NavigationLookup channel = lookup.withIndexUid("home");

        assertThat(service.indexPage(1L, folder, channel)).contains(page);
        assertThat(service.indexPage(1L, page, channel)).as("not a folder").isEmpty();
        assertThat(service.indexPage(1L, UUID.randomUUID(), channel)).isEmpty();
    }

    @Test
    void resolveReturnsNullForADanglingFolderTarget() {
        FakeNavigationLookup lookup = new FakeNavigationLookup();
        UUID navRoot = lookup.addFolder(null, "Navigation");
        UUID danglingFolder = lookup.addFolder(null, "Empty");
        UUID ref = lookup.addPageReferenceToFolder(navRoot, "Dead Link", danglingFolder, null);

        assertThat(service.resolve(1L, ref, lookup)).isNull();
        assertThat(service.firstNavigablePage(1L, danglingFolder, lookup)).isEmpty();
    }

    @Test
    void resolveReturnsNullWhenTheReferencedPageNoLongerExists() {
        FakeNavigationLookup lookup = new FakeNavigationLookup();
        UUID navRoot = lookup.addFolder(null, "Navigation");
        UUID page = lookup.addPage(null, "Home", 0);
        UUID ref = lookup.addPageReferenceToPage(navRoot, "Home Link", page, null);
        lookup.remove(page); // simulate a stale target (the documented asset_reference gap)

        assertThat(service.resolve(1L, ref, lookup)).isNull();
    }

    @Test
    void resolveFolderEntryIsEmptyForANullStartNode() {
        FakeNavigationLookup lookup = new FakeNavigationLookup();
        UUID folder = lookup.addFolder(null, "Section");

        assertThat(service.resolveFolderEntry(1L, folder, lookup)).isEmpty();
    }

    @Test
    void resolveFolderEntryResolvesThroughAPageReferenceStartNode() {
        FakeNavigationLookup lookup = new FakeNavigationLookup();
        UUID folder = lookup.addFolder(null, "Section");
        UUID page = lookup.addPage(null, "Home", 0);
        UUID ref = lookup.addPageReferenceToPage(folder, "Home Link", page, null);
        lookup.setStartNode(folder, "PAGE_REFERENCE", ref);

        assertThat(service.resolveFolderEntry(1L, folder, lookup)).contains(page);
    }

    @Test
    void resolveFolderEntryResolvesThroughAFolderStartNodeChain() {
        FakeNavigationLookup lookup = new FakeNavigationLookup();
        UUID outer = lookup.addFolder(null, "Outer");
        UUID inner = lookup.addFolder(outer, "Inner");
        UUID page = lookup.addPage(null, "Home", 0);
        UUID ref = lookup.addPageReferenceToPage(inner, "Home Link", page, null);
        lookup.setStartNode(inner, "PAGE_REFERENCE", ref);
        lookup.setStartNode(outer, "FOLDER", inner);

        assertThat(service.resolveFolderEntry(1L, outer, lookup)).contains(page);
    }

    @Test
    void startNodeCycleIsDetectedTruncatedAndReported() {
        FakeNavigationLookup lookup = new FakeNavigationLookup();
        UUID a = lookup.addFolder(null, "A");
        UUID b = lookup.addFolder(null, "B");
        lookup.setStartNode(a, "FOLDER", b);
        lookup.setStartNode(b, "FOLDER", a);

        List<Diagnostic> diagnostics = new ArrayList<>();
        Optional<UUID> result = service.resolveFolderEntry(1L, a, lookup, diagnostics);

        assertThat(result).isEmpty();
        assertThat(diagnostics).hasSize(1);
        assertThat(diagnostics.get(0).code()).isEqualTo(NavigationDiagnosticCodes.NAV_START_NODE_CYCLE);
    }

    @Test
    void startNodeChainDeeperThanMaxDepthIsTruncatedAndReportedEvenWithoutACycle() {
        FakeNavigationLookup lookup = new FakeNavigationLookup();
        UUID root = lookup.addFolder(null, "Root");
        UUID previous = root;
        // A strictly-acyclic chain one longer than MAX_DEPTH allows.
        for (int i = 0; i < PathService.MAX_DEPTH + 2; i++) {
            UUID next = lookup.addFolder(null, "F" + i);
            lookup.setStartNode(previous, "FOLDER", next);
            previous = next;
        }

        List<Diagnostic> diagnostics = new ArrayList<>();
        Optional<UUID> result = service.resolveFolderEntry(1L, root, lookup, diagnostics);

        assertThat(result).isEmpty();
        assertThat(diagnostics).isNotEmpty();
        assertThat(diagnostics.get(diagnostics.size() - 1).code()).isEqualTo(NavigationDiagnosticCodes.NAV_START_NODE_CYCLE);
    }

    @Test
    void treeBuildsNestedStructureWithPreResolvedPageUuidsAndLabels() {
        FakeNavigationLookup lookup = new FakeNavigationLookup();
        UUID root = lookup.addFolder(null, "Navigation");
        UUID page = lookup.addPage(null, "Home", 0);
        UUID homeRef = lookup.addPageReferenceToPage(root, "Home", page, "Home Label");
        UUID unlabeledPage = lookup.addPage(null, "About Us", 0);
        UUID aboutRef = lookup.addPageReferenceToPage(root, "About", unlabeledPage, null);
        UUID childFolder = lookup.addFolder(root, "Products");
        UUID productPage = lookup.addPage(childFolder, "Widgets", 0);
        UUID productRef = lookup.addPageReferenceToPage(childFolder, "Widgets Link", productPage, null);
        lookup.setStartNode(childFolder, "PAGE_REFERENCE", productRef);

        List<Diagnostic> diagnostics = new ArrayList<>();
        NavTreeNode tree = service.tree(1L, root, -1, lookup, diagnostics);

        assertThat(tree).isNotNull();
        assertThat(tree.assetUuid()).isEqualTo(root);
        assertThat(tree.resolvedPageUuid()).isNull(); // root itself has no startNode
        assertThat(tree.children()).hasSize(3);

        NavTreeNode homeNode = tree.children().stream().filter(n -> n.assetUuid().equals(homeRef)).findFirst().orElseThrow();
        assertThat(homeNode.resolvedPageUuid()).isEqualTo(page);
        assertThat(homeNode.label()).isEqualTo("Home Label");

        NavTreeNode aboutNode = tree.children().stream().filter(n -> n.assetUuid().equals(aboutRef)).findFirst().orElseThrow();
        assertThat(aboutNode.resolvedPageUuid()).isEqualTo(unlabeledPage);
        assertThat(aboutNode.label()).isEqualTo("About Us"); // coalesced onto target's displayName

        NavTreeNode childNode = tree.children().stream().filter(n -> n.assetUuid().equals(childFolder)).findFirst().orElseThrow();
        assertThat(childNode.resolvedPageUuid()).isEqualTo(productPage); // via its own startNode
        assertThat(childNode.children()).hasSize(1);
        assertThat(diagnostics).isEmpty();
    }

    @Test
    void anItemIsVisibleInTheMenuUnlessItSaysOtherwise() {
        FakeNavigationLookup lookup = new FakeNavigationLookup();
        UUID root = lookup.addFolder(null, "Navigation");
        UUID shown = lookup.addPageReferenceToPage(root, "Shown", lookup.addPage(null, "S", 0), null);
        UUID hiddenRef = lookup.addPageReferenceToPage(root, "Hidden ref", lookup.addPage(null, "H", 0), null);
        UUID hiddenFolder = lookup.addFolder(root, "Hidden folder");
        UUID explicitlyShown = lookup.addFolder(root, "Explicit");
        lookup.setVisibleInMenu(hiddenRef, false);
        lookup.setVisibleInMenu(hiddenFolder, false);
        lookup.setVisibleInMenu(explicitlyShown, true);

        NavTreeNode tree = service.tree(1L, root, -1, lookup, new ArrayList<>());

        assertThat(tree.visibleInMenu()).as("a payload without the field").isTrue();
        // The tree itself lists hidden entries too (the editor shows them); it only flags them.
        assertThat(tree.children()).extracting(NavTreeNode::assetUuid)
                .containsExactly(explicitlyShown, hiddenFolder, hiddenRef, shown);
        assertThat(tree.children()).extracting(NavTreeNode::visibleInMenu).containsExactly(true, false, false, true);
    }

    @Test
    void hidingAnItemChangesNeitherEntryPageNorPageResolution() {
        FakeNavigationLookup lookup = new FakeNavigationLookup();
        UUID root = lookup.addFolder(null, "Navigation");
        UUID section = lookup.addFolder(root, "Company");
        UUID page = lookup.addPage(null, "Our story", 0);
        UUID ref = lookup.addPageReferenceToPage(section, "Our story", page, null);
        lookup.setStartNode(section, "PAGE_REFERENCE", ref);
        lookup.setVisibleInMenu(ref, false);
        lookup.setVisibleInMenu(section, false);

        assertThat(service.resolve(1L, ref, lookup)).isEqualTo(page);
        assertThat(service.resolveFolderEntry(1L, section, lookup)).contains(page);
        NavTreeNode sectionNode = service.tree(1L, root, -1, lookup, new ArrayList<>()).children().get(0);
        assertThat(sectionNode.visibleInMenu()).isFalse();
        assertThat(sectionNode.resolvedPageUuid()).isEqualTo(page);
        assertThat(sectionNode.children().get(0).resolvedPageUuid()).isEqualTo(page);
    }

    @Test
    void aNonBooleanFlagCountsAsVisible() {
        FakeNavigationLookup lookup = new FakeNavigationLookup();
        UUID root = lookup.addFolder(null, "Navigation");
        UUID ref = lookup.addPageReferenceToPage(root, "Link", lookup.addPage(null, "P", 0), null);
        lookup.setVisibleInMenu(ref, false);
        assertThat(service.tree(1L, root, -1, lookup, new ArrayList<>()).children().get(0).visibleInMenu()).isFalse();
        assertThat(com.acme.staticforge.asset.folder.MenuVisibility.fromPayload(null)).isTrue();
        assertThat(com.acme.staticforge.asset.folder.MenuVisibility.fromPayload(
                        new com.fasterxml.jackson.databind.ObjectMapper().createObjectNode().put("visibleInMenu", "no")))
                .isTrue();
    }

    @Test
    void treeDepthZeroReturnsOnlyTheRootNode() {
        FakeNavigationLookup lookup = new FakeNavigationLookup();
        UUID root = lookup.addFolder(null, "Navigation");
        UUID page = lookup.addPage(null, "Home", 0);
        lookup.addPageReferenceToPage(root, "Home", page, null);

        NavTreeNode tree = service.tree(1L, root, 0, lookup, new ArrayList<>());

        assertThat(tree.children()).isEmpty();
    }

    @Test
    void treeReturnsNullForAnUnknownRoot() {
        FakeNavigationLookup lookup = new FakeNavigationLookup();
        assertThat(service.tree(1L, UUID.randomUUID(), -1, lookup, new ArrayList<>())).isNull();
    }

    @Test
    void treeListsChildrenAlphabeticallyUntilAnOrderIsStored() {
        FakeNavigationLookup lookup = new FakeNavigationLookup();
        UUID root = lookup.addFolder(null, "Navigation");
        UUID zebra = lookup.addPageReferenceToPage(root, "Zebra", lookup.addPage(null, "Z", 0), null);
        UUID alpha = lookup.addPageReferenceToPage(root, "Alpha", lookup.addPage(null, "A", 0), null);
        UUID beta = lookup.addFolder(root, "Beta");

        assertThat(childUuids(service.tree(1L, root, -1, lookup, new ArrayList<>()))).containsExactly(alpha, beta, zebra);
    }

    @Test
    void treeFollowsTheStoredChildOrderThenTheUnnamedAlphabetically() {
        FakeNavigationLookup lookup = new FakeNavigationLookup();
        UUID root = lookup.addFolder(null, "Navigation");
        UUID zebra = lookup.addPageReferenceToPage(root, "Zebra", lookup.addPage(null, "Z", 0), null);
        UUID alpha = lookup.addPageReferenceToPage(root, "Alpha", lookup.addPage(null, "A", 0), null);
        UUID beta = lookup.addFolder(root, "Beta");
        UUID gamma = lookup.addFolder(root, "Gamma");

        lookup.setChildOrder(root, zebra, beta);

        // Named first in the stored order; Alpha and Gamma follow alphabetically.
        assertThat(childUuids(service.tree(1L, root, -1, lookup, new ArrayList<>()))).containsExactly(zebra, beta, alpha, gamma);
    }

    @Test
    void aStoredOrderIgnoresEntriesThatAreNoLongerChildren() {
        FakeNavigationLookup lookup = new FakeNavigationLookup();
        UUID root = lookup.addFolder(null, "Navigation");
        UUID alpha = lookup.addPageReferenceToPage(root, "Alpha", lookup.addPage(null, "A", 0), null);
        UUID beta = lookup.addPageReferenceToPage(root, "Beta", lookup.addPage(null, "B", 0), null);
        UUID moved = lookup.addPageReferenceToPage(lookup.addFolder(null, "Elsewhere"), "Moved", lookup.addPage(null, "M", 0), null);

        lookup.setChildOrder(root, moved, beta, UUID.randomUUID(), alpha);

        assertThat(childUuids(service.tree(1L, root, -1, lookup, new ArrayList<>()))).containsExactly(beta, alpha);
    }

    @Test
    void theStoredOrderAppliesAtEveryLevel() {
        FakeNavigationLookup lookup = new FakeNavigationLookup();
        UUID root = lookup.addFolder(null, "Navigation");
        UUID section = lookup.addFolder(root, "Section");
        UUID alpha = lookup.addPageReferenceToPage(section, "Alpha", lookup.addPage(null, "A", 0), null);
        UUID beta = lookup.addPageReferenceToPage(section, "Beta", lookup.addPage(null, "B", 0), null);
        lookup.setChildOrder(section, beta, alpha);

        NavTreeNode tree = service.tree(1L, root, -1, lookup, new ArrayList<>());

        assertThat(childUuids(tree.children().get(0))).containsExactly(beta, alpha);
    }

    private static List<UUID> childUuids(NavTreeNode node) {
        return node.children().stream().map(NavTreeNode::assetUuid).toList();
    }
}
