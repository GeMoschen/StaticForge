package com.acme.staticforge.generate.quality;

import java.util.ArrayDeque;
import java.util.Deque;
import java.util.IdentityHashMap;
import java.util.Map;
import org.jsoup.nodes.Comment;
import org.jsoup.nodes.Document;
import org.jsoup.nodes.Element;
import org.jsoup.nodes.Node;
import org.jsoup.select.NodeTraversor;
import org.jsoup.select.NodeVisitor;

/**
 * Maps an element to the section instance that rendered it (M30, epic decision 13). The draft-check render (and only
 * it — never preview or generation output) wraps every rendered section instance in
 * {@code <!--sf:section {instanceId}-->…<!--/sf:section-->}; an element maps to the <em>innermost</em> section whose
 * markers enclose it in document order. A document without markers maps nothing.
 */
public final class SectionMarkers {

    /** The opening marker's comment text before the instance id. */
    static final String OPEN_PREFIX = "sf:section ";
    /** The closing marker's comment text. */
    static final String CLOSE = "/sf:section";

    private static final SectionMarkers NONE = new SectionMarkers(Map.of());

    private final Map<Element, String> sections;

    private SectionMarkers(Map<Element, String> sections) {
        this.sections = sections;
    }

    /** The opening marker of section instance {@code instanceId}, as the renderer writes it. */
    public static String open(String instanceId) {
        return "<!--" + OPEN_PREFIX + instanceId + "-->";
    }

    /** The closing marker, as the renderer writes it. */
    public static String close() {
        return "<!--" + CLOSE + "-->";
    }

    /** Whether {@code html} contains a section marker at all — a cheap test before walking a parsed document. */
    public static boolean present(String html) {
        return html.contains("<!--" + OPEN_PREFIX);
    }

    /** No markers: every element maps to {@code null}. */
    public static SectionMarkers none() {
        return NONE;
    }

    /** Reads the markers of {@code document} in one walk. */
    public static SectionMarkers of(Document document) {
        Map<Element, String> sections = new IdentityHashMap<>();
        Deque<String> open = new ArrayDeque<>();
        NodeTraversor.traverse(new NodeVisitor() {
            @Override
            public void head(Node node, int depth) {
                if (node instanceof Comment comment) {
                    String text = comment.getData().strip();
                    if (text.startsWith(OPEN_PREFIX)) {
                        open.push(text.substring(OPEN_PREFIX.length()).strip());
                    } else if (text.equals(CLOSE) && !open.isEmpty()) {
                        open.pop();
                    }
                } else if (node instanceof Element element && !open.isEmpty()) {
                    sections.put(element, open.peek());
                }
            }

            @Override
            public void tail(Node node, int depth) {
                // markers are read in document order on the way down
            }
        }, document);
        return sections.isEmpty() ? NONE : new SectionMarkers(sections);
    }

    /** The innermost section instance that rendered {@code element}; {@code null} outside every section. */
    public String sectionOf(Element element) {
        return element == null ? null : sections.get(element);
    }
}
