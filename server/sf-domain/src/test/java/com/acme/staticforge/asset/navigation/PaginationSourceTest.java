package com.acme.staticforge.asset.navigation;

import static org.assertj.core.api.Assertions.assertThat;

import com.acme.staticforge.pagination.PaginationItem;
import com.acme.staticforge.pagination.PaginationSource;
import com.acme.staticforge.pagination.PaginationValue;
import com.acme.staticforge.template.diagnostic.Diagnostic;
import com.acme.staticforge.template.query.RecordView;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.Test;

/**
 * {@link PaginationSource} (M21.2.1): eligibility, order and slicing of navigation and dataset sources. Lives next to
 * the {@link FakeNavigationLookup} it runs against.
 */
class PaginationSourceTest {

    private final NavigationService navigation = new NavigationServiceImpl();
    private final FakeNavigationLookup lookup = new FakeNavigationLookup();
    private final UUID folder = lookup.addFolder(null, "Blog");

    @Test
    void listsPageReferencesInNavigationOrderAndSkipsWhatIsNotAPage() {
        UUID beta = page("Beta", 0, null);
        UUID alpha = page("Alpha", 0, null);
        lookup.addPageReferenceToPage(folder, "b-ref", beta, null);
        lookup.addPageReferenceToPage(folder, "a-ref", alpha, "Alpha label");
        lookup.addFolder(folder, "Archive"); // a subfolder is no item
        UUID hidden = page("Hidden", 0, null);
        ((ObjectNode) lookup.byUuid(1L, hidden).orElseThrow().payload()).withObject("nav").put("visible", false);
        lookup.addPageReferenceToPage(folder, "h-ref", hidden, null);
        UUID gone = page("Gone", 0, null);
        lookup.addPageReferenceToPage(folder, "gone-ref", gone, null);
        lookup.remove(gone);

        PaginationSource.Result result = items("navigation", false);

        // Tree order is the $CMS_NAVIGATION order: display name of the reference, then uid.
        assertThat(result.items()).extracting(PaginationItem::uuid).containsExactly(alpha, beta);
        assertThat(result.items().get(0).label()).isEqualTo("Alpha label");
        assertThat(result.items().get(0).referenceUuid()).isNotNull();
        assertThat(result.warnings()).extracting(Diagnostic::code).containsExactly(NavigationDiagnosticCodes.NAV_PAGINATION_DANGLING_ITEM);
        assertThat(items("navigation", true).items()).extracting(PaginationItem::uuid).containsExactly(beta, alpha);
    }

    @Test
    void sortsByPositionDateAndDisplayNameWithADirectionOnThePrimaryKeyOnly() {
        UUID old = page("Old", 3, "2026-01-01");
        UUID recent = page("Recent", 1, "2026-09-01");
        UUID undated = page("Undated", 2, null);
        UUID sameDateA = page("Same A", 4, "2026-05-05");
        UUID sameDateB = page("Same B", 5, "2026-05-05");
        for (UUID target : List.of(old, recent, undated, sameDateB, sameDateA)) {
            lookup.addPageReferenceToPage(folder, "ref", target, null);
        }
        // Equal dates break by the target's uid (the fake's uids are the uuids), in either direction.
        List<UUID> sameDate = java.util.stream.Stream.of(sameDateA, sameDateB).sorted(java.util.Comparator.comparing(UUID::toString)).toList();

        assertThat(uuids("date", false)).containsExactly(old, sameDate.get(0), sameDate.get(1), recent, undated);
        assertThat(uuids("date", true)).containsExactly(recent, sameDate.get(0), sameDate.get(1), old, undated);
        assertThat(uuids("position", false)).containsExactly(recent, undated, old, sameDateA, sameDateB);
        assertThat(uuids("position", true)).containsExactly(sameDateB, sameDateA, old, undated, recent);
        assertThat(uuids("displayName", false)).containsExactly(old, recent, sameDateA, sameDateB, undated);
        assertThat(uuids("displayName", true)).containsExactly(undated, sameDateB, sameDateA, recent, old);
    }

    @Test
    void equalKeysAlwaysLandInTheSameOrder() {
        List<UUID> twins = new java.util.ArrayList<>();
        for (int i = 0; i < 6; i++) {
            UUID target = page("Twin", 0, "2026-01-01");
            lookup.addPageReferenceToPage(folder, "ref", target, null);
            twins.add(target);
        }
        List<UUID> byUid = twins.stream().sorted(java.util.Comparator.comparing(UUID::toString)).toList();

        for (int run = 0; run < 5; run++) {
            assertThat(uuids("date", false)).isEqualTo(byUid);
            assertThat(uuids("date", true)).isEqualTo(byUid);
            assertThat(uuids("position", true)).isEqualTo(byUid);
            assertThat(uuids("displayName", false)).isEqualTo(byUid);
        }
    }

    @Test
    void sortsDatasetRecordsByTheFieldThenUid() {
        UUID dataset = UUID.randomUUID();
        RecordView b = record("b", 2);
        RecordView a = record("a", 2);
        RecordView c = record("c", 1);
        PaginationValue value = new PaginationValue("posts", PaginationValue.Kind.DATASET, dataset, 2, "rank", false);

        List<PaginationItem> items = PaginationSource
                .items(1L, value, navigation, lookup, Map.of(dataset, List.of(b, a, c))::get)
                .items();

        assertThat(items).extracting(PaginationItem::uid).containsExactly("c", "a", "b");
        assertThat(items).allMatch(PaginationItem::isRecord);
        PaginationValue descending = new PaginationValue("posts", PaginationValue.Kind.DATASET, dataset, 2, "rank", true);
        assertThat(PaginationSource.items(1L, descending, navigation, lookup, Map.of(dataset, List.of(b, a, c))::get).items())
                .extracting(PaginationItem::uid)
                .containsExactly("a", "b", "c");
    }

    @Test
    void countsAndSlicesPages() {
        assertThat(PaginationSource.totalPages(0, 10)).isEqualTo(1);
        assertThat(PaginationSource.totalPages(1, 10)).isEqualTo(1);
        assertThat(PaginationSource.totalPages(20, 10)).isEqualTo(2);
        assertThat(PaginationSource.totalPages(23, 10)).isEqualTo(3);

        for (int i = 0; i < 23; i++) {
            lookup.addPageReferenceToPage(folder, "ref " + (char) ('a' + i), page("P" + i, 0, null), null);
        }
        List<PaginationItem> items = items("navigation", false).items();
        assertThat(PaginationSource.slice(items, 10, 2)).isEqualTo(items.subList(10, 20));
        assertThat(PaginationSource.slice(items, 10, 3)).hasSize(3);
        assertThat(PaginationSource.slice(items, 10, 4)).isEmpty();
        assertThat(PaginationSource.slice(List.of(), 10, 1)).isEmpty();
    }

    @Test
    void aMissingFolderHasNoItems() {
        PaginationValue value = new PaginationValue("posts", PaginationValue.Kind.NAV, UUID.randomUUID(), 10, "navigation", false);

        assertThat(PaginationSource.items(1L, value, navigation, lookup, uuid -> List.of()).items()).isEmpty();
    }

    private UUID page(String displayName, int position, String date) {
        UUID uuid = lookup.addPage(null, displayName, position);
        if (date != null) {
            ((ObjectNode) lookup.byUuid(1L, uuid).orElseThrow().payload()).withObject("nav").put("date", date);
        }
        return uuid;
    }

    private PaginationSource.Result items(String sortKey, boolean descending) {
        PaginationValue value = new PaginationValue("posts", PaginationValue.Kind.NAV, folder, 10, sortKey, descending);
        return PaginationSource.items(1L, value, navigation, lookup, uuid -> List.of());
    }

    private List<UUID> uuids(String sortKey, boolean descending) {
        return items(sortKey, descending).items().stream().map(PaginationItem::uuid).toList();
    }

    private static RecordView record(String uid, int rank) {
        ObjectNode content = new ObjectMapper().createObjectNode().put("rank", rank);
        return new RecordView(UUID.randomUUID(), uid, uid.toUpperCase(), "/", "items", Instant.EPOCH, content);
    }
}
