package com.acme.staticforge.pagination;

import com.acme.staticforge.asset.AssetType;
import com.acme.staticforge.asset.navigation.NavTreeNode;
import com.acme.staticforge.asset.navigation.NavigationAsset;
import com.acme.staticforge.asset.navigation.NavigationDiagnosticCodes;
import com.acme.staticforge.asset.navigation.NavigationLookup;
import com.acme.staticforge.asset.navigation.NavigationService;
import com.acme.staticforge.template.diagnostic.Diagnostic;
import com.acme.staticforge.template.query.DatasetQueryEvaluator;
import com.acme.staticforge.template.query.RecordView;
import com.acme.staticforge.template.query.SortKey;
import com.fasterxml.jackson.databind.JsonNode;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.List;
import java.util.UUID;
import java.util.function.Function;

/**
 * The one eligibility and ordering function of a pagination source (M21.2.1). The planner counts pages with it and
 * the renderer slices the very list it returned; preview runs it against live data. It never touches a repository
 * itself: navigation comes through a {@link NavigationLookup} (snapshot or live), records through a function (the
 * snapshot record index or the live resolver), so generation and preview can't diverge.
 *
 * <p><b>Navigation source:</b> the page references directly in the folder, in the order {@code $CMS_NAVIGATION}
 * renders them. A reference that resolves to no page is skipped with an {@code SF-GEN-0412} warning (it doesn't fail
 * the page like {@code SF-GEN-0411} does for {@code $CMS_NAVIGATION}: a listing stays useful without one entry). A
 * target page with {@code nav.visible=false} is skipped. Sort keys: {@code navigation} (tree order), {@code position}
 * ({@code nav.position}), {@code date} ({@code nav.date}, else {@code publishedOn}; pages without one last) and
 * {@code displayName}; ties break by the target's uid, then the reference's uuid, so the order is total.
 *
 * <p><b>Dataset source:</b> the dataset's live records sorted by the chosen field, then {@code _uid}, then
 * {@code _uuid}. The direction applies to the primary key only, for both sources.
 */
public final class PaginationSource {

    private static final Comparator<String> TEXT = Comparator.nullsLast(
            String.CASE_INSENSITIVE_ORDER.thenComparing(Comparator.naturalOrder()));

    private PaginationSource() {}

    /** The eligible items in page order, plus the warnings for skipped entries. */
    public record Result(List<PaginationItem> items, List<Diagnostic> warnings) {

        public Result {
            items = List.copyOf(items);
            warnings = List.copyOf(warnings);
        }
    }

    /**
     * Resolves {@code value}'s source.
     *
     * @param records a dataset's live records at the render's revision
     */
    public static Result items(
            long projectId,
            PaginationValue value,
            NavigationService navigation,
            NavigationLookup lookup,
            Function<UUID, List<RecordView>> records) {
        return value.kind() == PaginationValue.Kind.NAV
                ? navigationItems(projectId, value, navigation, lookup)
                : new Result(datasetItems(value, records.apply(value.sourceUuid())), List.of());
    }

    /** {@code max(1, ceil(itemCount / pageSize))}: an empty source still has one (empty) page. */
    public static int totalPages(int itemCount, int pageSize) {
        return Math.max(1, (itemCount + pageSize - 1) / pageSize);
    }

    /** The items of 1-based {@code pageNumber}; empty past the last item. */
    public static List<PaginationItem> slice(List<PaginationItem> items, int pageSize, int pageNumber) {
        long from = (long) (pageNumber - 1) * pageSize;
        if (pageNumber < 1 || from >= items.size()) {
            return List.of();
        }
        return items.subList((int) from, (int) Math.min(from + pageSize, items.size()));
    }

    private static Result navigationItems(
            long projectId, PaginationValue value, NavigationService navigation, NavigationLookup lookup) {
        List<Diagnostic> warnings = new ArrayList<>();
        NavTreeNode folder = navigation.tree(projectId, value.sourceUuid(), 1, lookup, warnings);
        if (folder == null || folder.type() != AssetType.FOLDER) {
            return new Result(List.of(), warnings);
        }
        List<PaginationItem> items = new ArrayList<>();
        for (NavTreeNode child : folder.children()) {
            if (child.type() != AssetType.PAGE_REFERENCE) {
                continue;
            }
            NavigationAsset target = child.resolvedPageUuid() == null
                    ? null
                    : lookup.byUuid(projectId, child.resolvedPageUuid()).orElse(null);
            if (target == null) {
                warnings.add(Diagnostic.warning(
                        NavigationDiagnosticCodes.NAV_PAGINATION_DANGLING_ITEM,
                        "Pagination skips navigation reference '" + child.uid() + "': it does not resolve to any page.",
                        0, 0));
                continue;
            }
            JsonNode payload = target.payload();
            if (payload != null && !payload.path("nav").path("visible").asBoolean(true)) {
                continue;
            }
            items.add(new PaginationItem(
                    target.uuid(), target.uid(), target.displayName(), child.label(), date(payload),
                    payload == null ? 0 : payload.path("nav").path("position").asInt(0), child.assetUuid(), null));
        }
        List<PaginationItem> sorted = new ArrayList<>(items);
        Comparator<PaginationItem> primary = switch (value.sortKey()) {
            case "position" -> Comparator.comparingInt(PaginationItem::position);
            case "date" -> dateOrder(value.descending());
            case "displayName" -> Comparator.comparing(PaginationItem::displayName, TEXT);
            default -> null; // navigation: the tree order is already total
        };
        if (primary == null) {
            if (value.descending()) {
                Collections.reverse(sorted);
            }
            return new Result(sorted, warnings);
        }
        if (value.descending() && !"date".equals(value.sortKey())) {
            primary = primary.reversed();
        }
        sorted.sort(primary
                .thenComparing(PaginationItem::uid, TEXT)
                .thenComparing(PaginationItem::referenceUuid));
        return new Result(sorted, warnings);
    }

    /** Dated pages in {@code descending} or ascending order, undated pages always last. */
    private static Comparator<PaginationItem> dateOrder(boolean descending) {
        Comparator<String> dates = descending ? Comparator.<String>reverseOrder() : Comparator.<String>naturalOrder();
        return Comparator.comparing(PaginationItem::date, Comparator.nullsLast(dates));
    }

    private static List<PaginationItem> datasetItems(PaginationValue value, List<RecordView> records) {
        List<SortKey> keys = List.of(
                new SortKey(value.sortKey(), value.descending() ? SortKey.Direction.DESC : SortKey.Direction.ASC),
                SortKey.asc("_uid"),
                SortKey.asc("_uuid"));
        List<RecordView> sorted = DatasetQueryEvaluator.sort(records == null ? List.of() : records, keys);
        List<PaginationItem> items = new ArrayList<>(sorted.size());
        for (RecordView record : sorted) {
            items.add(new PaginationItem(
                    record.uuid(), record.uid(), record.displayName(), record.displayName(), null, 0, null, record));
        }
        return items;
    }

    private static String date(JsonNode payload) {
        if (payload == null) {
            return null;
        }
        JsonNode navDate = payload.path("nav").path("date");
        if (navDate.isTextual() && !navDate.asText().isBlank()) {
            return navDate.asText();
        }
        JsonNode publishedOn = payload.path("publishedOn");
        return publishedOn.isTextual() && !publishedOn.asText().isBlank() ? publishedOn.asText() : null;
    }
}
