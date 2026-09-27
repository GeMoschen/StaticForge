package com.acme.staticforge.generate.quality;

import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.IdentityHashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Pattern;
import org.jsoup.nodes.Document;
import org.jsoup.nodes.Element;

/**
 * Stable, short CSS selectors for the elements of one document (M30.1.1), so a finding can point at its element: the
 * path from the nearest ancestor with a unique id (or from {@code body}/{@code head}) down to the element, each step
 * its tag and, when it has same-tag siblings, {@code :nth-of-type(n)} — e.g. {@code main#content > p:nth-of-type(2) >
 * img}. The selector depends only on the document's structure, so two parses of the same bytes give the same selector.
 *
 * <p>Ids are used as written (case-sensitive) and only when unique in the document and a plain CSS identifier; any
 * other id is skipped, not escaped. Not thread-safe: one instance per document, used by one thread.
 */
public final class Selectors {

    private static final Pattern PLAIN_IDENTIFIER = Pattern.compile("-?[A-Za-z_][A-Za-z0-9_-]*");

    private final Map<String, Integer> idCounts;
    private final Map<Element, String> steps = new IdentityHashMap<>();

    private Selectors(Map<String, Integer> idCounts) {
        this.idCounts = idCounts;
    }

    /** Selectors for {@code document}, counting its ids once. */
    public static Selectors of(Document document) {
        Map<String, Integer> counts = new HashMap<>();
        for (Element element : document.getAllElements()) {
            String id = element.id();
            if (!id.isEmpty()) {
                counts.merge(id, 1, Integer::sum);
            }
        }
        return new Selectors(counts);
    }

    /** The selector of {@code element}. */
    public String of(Element element) {
        List<String> path = new ArrayList<>();
        Element current = element;
        while (current != null && !(current instanceof Document)) {
            String tag = current.normalName();
            String id = current.id();
            if (!id.isEmpty() && idCounts.getOrDefault(id, 0) == 1 && PLAIN_IDENTIFIER.matcher(id).matches()) {
                path.add(tag + "#" + id);
                break;
            }
            if (tag.equals("html") || tag.equals("body") || tag.equals("head") || current.parent() == null
                    || current.parent() instanceof Document) {
                path.add(tag);
                break;
            }
            path.add(step(current));
            current = current.parent();
        }
        Collections.reverse(path);
        return String.join(" > ", path);
    }

    /** {@code tag} or {@code tag:nth-of-type(n)}; computed for all children of a parent at once. */
    private String step(Element element) {
        String step = steps.get(element);
        if (step != null) {
            return step;
        }
        Element parent = element.parent();
        Map<String, Integer> totals = new HashMap<>();
        for (Element sibling : parent.children()) {
            totals.merge(sibling.normalName(), 1, Integer::sum);
        }
        Map<String, Integer> seen = new HashMap<>();
        for (Element sibling : parent.children()) {
            String tag = sibling.normalName();
            int index = seen.merge(tag, 1, Integer::sum);
            steps.put(sibling, totals.get(tag) > 1 ? tag + ":nth-of-type(" + index + ")" : tag);
        }
        return steps.get(element);
    }
}
