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

        assertThat(service.resolve(ref, lookup)).isEqualTo(page);
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

        assertThat(service.resolve(ref, lookup)).isEqualTo(first);
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

        assertThat(service.resolve(ref, lookup)).isEqualTo(deepPage);
        assertThat(service.firstNavigablePage(emptySubA, lookup)).isEmpty();
    }

    @Test
    void resolveReturnsNullForADanglingFolderTarget() {
        FakeNavigationLookup lookup = new FakeNavigationLookup();
        UUID navRoot = lookup.addFolder(null, "Navigation");
        UUID danglingFolder = lookup.addFolder(null, "Empty");
        UUID ref = lookup.addPageReferenceToFolder(navRoot, "Dead Link", danglingFolder, null);

        assertThat(service.resolve(ref, lookup)).isNull();
        assertThat(service.firstNavigablePage(danglingFolder, lookup)).isEmpty();
    }

    @Test
    void resolveReturnsNullWhenTheReferencedPageNoLongerExists() {
        FakeNavigationLookup lookup = new FakeNavigationLookup();
        UUID navRoot = lookup.addFolder(null, "Navigation");
        UUID page = lookup.addPage(null, "Home", 0);
        UUID ref = lookup.addPageReferenceToPage(navRoot, "Home Link", page, null);
        lookup.remove(page); // simulate a stale target (the documented asset_reference gap)

        assertThat(service.resolve(ref, lookup)).isNull();
    }

    @Test
    void resolveFolderEntryIsEmptyForANullStartNode() {
        FakeNavigationLookup lookup = new FakeNavigationLookup();
        UUID folder = lookup.addFolder(null, "Section");

        assertThat(service.resolveFolderEntry(folder, lookup)).isEmpty();
    }

    @Test
    void resolveFolderEntryResolvesThroughAPageReferenceStartNode() {
        FakeNavigationLookup lookup = new FakeNavigationLookup();
        UUID folder = lookup.addFolder(null, "Section");
        UUID page = lookup.addPage(null, "Home", 0);
        UUID ref = lookup.addPageReferenceToPage(folder, "Home Link", page, null);
        lookup.setStartNode(folder, "PAGE_REFERENCE", ref);

        assertThat(service.resolveFolderEntry(folder, lookup)).contains(page);
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

        assertThat(service.resolveFolderEntry(outer, lookup)).contains(page);
    }

    @Test
    void startNodeCycleIsDetectedTruncatedAndReported() {
        FakeNavigationLookup lookup = new FakeNavigationLookup();
        UUID a = lookup.addFolder(null, "A");
        UUID b = lookup.addFolder(null, "B");
        lookup.setStartNode(a, "FOLDER", b);
        lookup.setStartNode(b, "FOLDER", a);

        List<Diagnostic> diagnostics = new ArrayList<>();
        Optional<UUID> result = service.resolveFolderEntry(a, lookup, diagnostics);

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
        Optional<UUID> result = service.resolveFolderEntry(root, lookup, diagnostics);

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
        NavTreeNode tree = service.tree(root, -1, lookup, diagnostics);

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
    void treeDepthZeroReturnsOnlyTheRootNode() {
        FakeNavigationLookup lookup = new FakeNavigationLookup();
        UUID root = lookup.addFolder(null, "Navigation");
        UUID page = lookup.addPage(null, "Home", 0);
        lookup.addPageReferenceToPage(root, "Home", page, null);

        NavTreeNode tree = service.tree(root, 0, lookup, new ArrayList<>());

        assertThat(tree.children()).isEmpty();
    }

    @Test
    void treeReturnsNullForAnUnknownRoot() {
        FakeNavigationLookup lookup = new FakeNavigationLookup();
        assertThat(service.tree(UUID.randomUUID(), -1, lookup, new ArrayList<>())).isNull();
    }
}
