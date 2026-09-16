package com.acme.staticforge.pagination;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.List;
import java.util.function.Function;

/**
 * Builds the read-only {@code CMS_PAGINATION} value of one page of a paginated page (M21.3.1): the slice of items and
 * the page links. The one slicing and link-building helper, shared by generation and preview; each supplies how a page
 * number and an item turn into an href (relative output paths there, preview URLs here), so neither builds links by
 * string concatenation.
 *
 * <pre>
 * { items: [...], current, total, pageSize, itemCount,
 *   firstHref, prevHref, nextHref, lastHref, canonicalHref,
 *   pages: [{number, href, current}] }
 * </pre>
 *
 * {@code prevHref} is empty on the first page and {@code nextHref} on the last. A navigation item is
 * {@code {uuid, uid, displayName, label, href, date?, position, content}}; a record item is the record's fields (as a
 * dataset loop sees them) plus {@code uuid, uid}, and {@code displayName, label} unless the record has such fields.
 */
public final class PaginationScope {

    private PaginationScope() {}

    /** How the caller links pages and items. */
    public interface Links {

        /** The href of 1-based page {@code number} of this paginated page, relative to the page being rendered. */
        String page(int number);

        /** The href of a navigation item's target page, relative to the page being rendered. */
        String item(PaginationItem item);
    }

    /**
     * @param items every eligible item, in order (the list the page count came from)
     * @param pageNumber the 1-based page being rendered, within {@code 1..totalPages}
     * @param content a navigation item's target page values ({@code content} of the item)
     */
    public static ObjectNode build(
            List<PaginationItem> items, int pageSize, int pageNumber, Links links, Function<PaginationItem, JsonNode> content) {
        JsonNodeFactory json = JsonNodeFactory.instance;
        int total = PaginationSource.totalPages(items.size(), pageSize);
        ObjectNode scope = json.objectNode();
        ArrayNode sliced = scope.putArray("items");
        for (PaginationItem item : PaginationSource.slice(items, pageSize, pageNumber)) {
            sliced.add(item.isRecord() ? recordItem(item) : navigationItem(item, links, content));
        }
        scope.put("current", pageNumber);
        scope.put("total", total);
        scope.put("pageSize", pageSize);
        scope.put("itemCount", items.size());
        scope.put("firstHref", links.page(1));
        scope.put("prevHref", pageNumber > 1 ? links.page(pageNumber - 1) : "");
        scope.put("nextHref", pageNumber < total ? links.page(pageNumber + 1) : "");
        scope.put("lastHref", links.page(total));
        scope.put("canonicalHref", links.page(pageNumber));
        ArrayNode pages = scope.putArray("pages");
        for (int number = 1; number <= total; number++) {
            pages.addObject()
                    .put("number", number)
                    .put("href", links.page(number))
                    .put("current", number == pageNumber);
        }
        return scope;
    }

    private static ObjectNode navigationItem(PaginationItem item, Links links, Function<PaginationItem, JsonNode> content) {
        ObjectNode node = JsonNodeFactory.instance.objectNode();
        node.put("uuid", item.uuid().toString());
        node.put("uid", item.uid());
        node.put("displayName", item.displayName());
        node.put("label", item.label());
        node.put("href", links.item(item));
        if (item.date() != null) {
            node.put("date", item.date());
        }
        node.put("position", item.position());
        JsonNode values = content.apply(item);
        node.set("content", values != null && values.isObject() ? values : JsonNodeFactory.instance.objectNode());
        return node;
    }

    private static ObjectNode recordItem(PaginationItem item) {
        ObjectNode node = ((ObjectNode) item.record().item()).deepCopy();
        node.put("uuid", item.uuid().toString());
        node.put("uid", item.uid());
        // A record editor named displayName or label keeps its value; _displayName always holds the record's.
        if (!node.has("displayName")) {
            node.put("displayName", item.displayName());
        }
        if (!node.has("label")) {
            node.put("label", item.label());
        }
        return node;
    }
}
