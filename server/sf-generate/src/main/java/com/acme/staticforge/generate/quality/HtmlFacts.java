package com.acme.staticforge.generate.quality;

import com.fasterxml.jackson.annotation.JsonIgnore;
import com.fasterxml.jackson.annotation.JsonInclude;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.regex.Pattern;
import org.jsoup.nodes.Document;
import org.jsoup.nodes.Element;

/**
 * What one parsed HTML output tells the site-wide rules (M30.1.1, epic decision 7), extracted in one pass over the
 * document. Facts are persisted per output in the build's {@code quality.json} sidecar, so an incremental run can
 * check carried outputs without their bytes; to keep that small, ids and links are capped at {@link #MAX_IDS} and
 * {@link #MAX_LINKS} per output, with a flag when a cap was hit.
 *
 * @param title the {@code <title>} text, whitespace-normalized; {@code null} when there is no {@code <title>}
 * @param metaDescription the {@code content} of {@code <meta name="description">}; {@code null} without one
 * @param h1Count how many {@code h1} elements the document has
 * @param lang the {@code lang} attribute of {@code <html>} as written; {@code null} when absent
 * @param canonical the first {@code <link rel="canonical">}; {@code null} without one
 * @param alternates every {@code <link rel="alternate" hreflang>}, in document order
 * @param robotsMeta the {@code content} of every {@code <meta name="robots">}, joined with {@code ", "}; {@code null}
 *     without one
 * @param ids every non-empty element {@code id} in document order, duplicates kept (a multiset), as written
 * @param anchors every non-empty {@code <a name>}, as written
 * @param links every outgoing reference ({@code a[href]}, {@code link[href]}, {@code img[src|srcset]},
 *     {@code source[src|srcset]}, {@code script[src]}, {@code iframe[src]}, {@code video[src|poster]},
 *     {@code audio[src]}), one per {@code srcset} candidate
 * @param idsTruncated more than {@link #MAX_IDS} ids (or anchors) — the rest weren't recorded
 * @param linksTruncated more than {@link #MAX_LINKS} links — the rest weren't recorded
 */
@JsonInclude(JsonInclude.Include.NON_NULL)
public record HtmlFacts(
        String title,
        String metaDescription,
        int h1Count,
        String lang,
        LinkRef canonical,
        List<Alternate> alternates,
        String robotsMeta,
        List<String> ids,
        List<String> anchors,
        List<LinkRef> links,
        boolean idsTruncated,
        boolean linksTruncated) {

    private static final Pattern WHITESPACE = Pattern.compile("\\s+");

    /** At most this many ids and this many anchors are recorded per output. */
    public static final int MAX_IDS = 2_000;

    /** At most this many links are recorded per output. */
    public static final int MAX_LINKS = 2_000;

    public HtmlFacts {
        alternates = alternates == null ? List.of() : List.copyOf(alternates);
        ids = ids == null ? List.of() : List.copyOf(ids);
        anchors = anchors == null ? List.of() : List.copyOf(anchors);
        links = links == null ? List.of() : List.copyOf(links);
    }

    /**
     * One {@code hreflang} alternate.
     *
     * @param hreflang the {@code hreflang} value as written ({@code de}, {@code en-GB}, {@code x-default})
     */
    public record Alternate(String hreflang, LinkRef link) {}

    /** Whether {@code fragment} names an element of this output: an {@code id} or an {@code <a name>}. */
    public boolean hasTarget(String fragment) {
        return fragment != null && (ids.contains(fragment) || anchors.contains(fragment));
    }

    /** The distinct ids and anchor names — what a {@code #fragment} can point at. */
    @JsonIgnore
    public Set<String> targets() {
        Set<String> targets = new HashSet<>(ids);
        targets.addAll(anchors);
        return targets;
    }

    /**
     * Extracts the facts of {@code document}, the output at {@code path}.
     *
     * @param resolver resolves the output's links against the build
     * @param selectors the document's selectors, shared with the page rules
     */
    public static HtmlFacts extract(Document document, String path, LinkResolver resolver, Selectors selectors) {
        return new Extraction(path, resolver, selectors).run(document);
    }

    /** The one pass over the document. */
    private static final class Extraction {

        private final String path;
        private final LinkResolver resolver;
        private final Selectors selectors;

        private String title;
        private String metaDescription;
        private int h1Count;
        private String lang;
        private LinkRef canonical;
        private final List<Alternate> alternates = new ArrayList<>();
        private final List<String> robots = new ArrayList<>();
        private final List<String> ids = new ArrayList<>();
        private final List<String> anchors = new ArrayList<>();
        private final List<LinkRef> links = new ArrayList<>();
        private boolean idsTruncated;
        private boolean linksTruncated;

        Extraction(String path, LinkResolver resolver, Selectors selectors) {
            this.path = path;
            this.resolver = resolver;
            this.selectors = selectors;
        }

        HtmlFacts run(Document document) {
            for (Element element : document.getAllElements()) {
                visit(element);
            }
            return new HtmlFacts(
                    title,
                    metaDescription,
                    h1Count,
                    lang,
                    canonical,
                    alternates,
                    robots.isEmpty() ? null : String.join(", ", robots),
                    ids,
                    anchors,
                    links,
                    idsTruncated,
                    linksTruncated);
        }

        private void visit(Element element) {
            String id = element.id();
            if (!id.isEmpty()) {
                if (ids.size() < MAX_IDS) {
                    ids.add(id);
                } else {
                    idsTruncated = true;
                }
            }
            switch (element.normalName()) {
                case "html" -> {
                    if (lang == null && element.hasAttr("lang")) {
                        lang = element.attr("lang");
                    }
                }
                case "title" -> {
                    // A <title> inside <svg> names the drawing, not the document.
                    if (title == null && element.closest("svg") == null) {
                        title = WHITESPACE.matcher(element.text()).replaceAll(" ").strip();
                    }
                }
                case "h1" -> h1Count++;
                case "meta" -> meta(element);
                case "a" -> {
                    String name = element.attr("name");
                    if (!name.isEmpty()) {
                        if (anchors.size() < MAX_IDS) {
                            anchors.add(name);
                        } else {
                            idsTruncated = true;
                        }
                    }
                    attribute(element, "href");
                }
                case "link" -> link(element);
                case "img", "source" -> {
                    attribute(element, "src");
                    srcset(element);
                }
                case "script", "iframe", "audio" -> attribute(element, "src");
                case "video" -> {
                    attribute(element, "src");
                    attribute(element, "poster");
                }
                default -> {
                    // no facts
                }
            }
        }

        private void meta(Element element) {
            String name = element.attr("name").strip().toLowerCase(Locale.ROOT);
            if (name.equals("description") && metaDescription == null) {
                metaDescription = element.attr("content");
            } else if (name.equals("robots")) {
                robots.add(element.attr("content").strip());
            }
        }

        private void link(Element element) {
            LinkRef ref = attribute(element, "href");
            if (ref == null) {
                return;
            }
            Set<String> rel = relTokens(element);
            if (rel.contains("canonical") && canonical == null) {
                canonical = ref;
            }
            if (rel.contains("alternate") && element.hasAttr("hreflang")) {
                alternates.add(new Alternate(element.attr("hreflang").strip(), ref));
            }
        }

        private static Set<String> relTokens(Element element) {
            Set<String> tokens = new HashSet<>();
            for (String token : element.attr("rel").toLowerCase(Locale.ROOT).split("\\s+")) {
                if (!token.isEmpty()) {
                    tokens.add(token);
                }
            }
            return tokens;
        }

        /** Records {@code element[attribute]} when present; returns the reference (also when not recorded). */
        private LinkRef attribute(Element element, String attribute) {
            if (!element.hasAttr(attribute)) {
                return null;
            }
            return add(element, attribute, element.attr(attribute));
        }

        private void srcset(Element element) {
            if (!element.hasAttr("srcset")) {
                return;
            }
            for (String candidate : srcsetUrls(element.attr("srcset"))) {
                add(element, "srcset", candidate);
            }
        }

        private LinkRef add(Element element, String attribute, String raw) {
            LinkResolver.Target target = resolver.resolve(path, raw);
            LinkRef ref = new LinkRef(
                    element.normalName(),
                    attribute,
                    raw,
                    target == null ? null : target.path(),
                    target == null ? fragmentOf(raw) : target.fragment(),
                    selectors.of(element));
            if (links.size() < MAX_LINKS) {
                links.add(ref);
            } else {
                linksTruncated = true;
            }
            return ref;
        }

        private static String fragmentOf(String raw) {
            int hash = raw.indexOf('#');
            return hash < 0 ? null : LinkResolver.decode(raw.substring(hash + 1));
        }
    }

    /**
     * The URLs of a {@code srcset} value (HTML's "parse a srcset attribute", without validating descriptors): candidates
     * are separated by commas; each is a URL, optionally followed by whitespace and a descriptor ({@code 2x},
     * {@code 480w}). A URL may itself contain commas, but not start or end with one.
     */
    static List<String> srcsetUrls(String srcset) {
        List<String> urls = new ArrayList<>();
        int i = 0;
        int n = srcset.length();
        while (i < n) {
            while (i < n && (Character.isWhitespace(srcset.charAt(i)) || srcset.charAt(i) == ',')) {
                i++;
            }
            if (i >= n) {
                break;
            }
            int start = i;
            while (i < n && !Character.isWhitespace(srcset.charAt(i))) {
                i++;
            }
            String url = srcset.substring(start, i);
            boolean endedCandidate = false;
            while (url.endsWith(",")) {
                url = url.substring(0, url.length() - 1);
                endedCandidate = true;
            }
            if (!url.isEmpty()) {
                urls.add(url);
            }
            if (!endedCandidate) {
                // Skip the descriptors up to the next comma outside parentheses.
                int depth = 0;
                while (i < n) {
                    char c = srcset.charAt(i);
                    if (c == '(') {
                        depth++;
                    } else if (c == ')' && depth > 0) {
                        depth--;
                    } else if (c == ',' && depth == 0) {
                        i++;
                        break;
                    }
                    i++;
                }
            }
        }
        return urls;
    }
}
