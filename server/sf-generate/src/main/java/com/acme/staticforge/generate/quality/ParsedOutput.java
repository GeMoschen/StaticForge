package com.acme.staticforge.generate.quality;

import java.nio.charset.StandardCharsets;
import java.util.Objects;
import org.jsoup.Jsoup;
import org.jsoup.nodes.Document;
import org.jsoup.nodes.Element;
import org.jsoup.parser.Parser;

/**
 * One HTML output, parsed once for every page rule (M30, epic decision 11): the jsoup document, its {@link HtmlFacts},
 * the output it is, and the document's selectors and section markers. Rules read the document; nothing is ever
 * serialized back into the output (checks never change bytes).
 *
 * <p>Not thread-safe (the selectors cache per document): the page rules of one output run on one thread.
 */
public final class ParsedOutput {

    private final OutputKey key;
    private final Document document;
    private final HtmlFacts facts;
    private final Selectors selectors;
    private final SectionMarkers sections;

    private ParsedOutput(OutputKey key, Document document, HtmlFacts facts, Selectors selectors, SectionMarkers sections) {
        this.key = key;
        this.document = document;
        this.facts = facts;
        this.selectors = selectors;
        this.sections = sections;
    }

    /**
     * Parses {@code html} (UTF-8, as the pipeline writes it) with the lenient HTML parser and extracts its facts. Section
     * markers are read only when the text contains one.
     *
     * @param resolver resolves the output's links against the build ({@link CheckEnvironment#resolverFor})
     */
    public static ParsedOutput parse(OutputKey key, byte[] html, LinkResolver resolver) {
        return parse(key, new String(html, StandardCharsets.UTF_8), resolver);
    }

    /** As {@link #parse(OutputKey, byte[], LinkResolver)} for text. */
    public static ParsedOutput parse(OutputKey key, String html, LinkResolver resolver) {
        Objects.requireNonNull(key, "key");
        Document document = Jsoup.parse(html, "", Parser.htmlParser());
        Selectors selectors = Selectors.of(document);
        HtmlFacts facts = HtmlFacts.extract(document, key.path(), resolver, selectors);
        SectionMarkers sections = SectionMarkers.present(html) ? SectionMarkers.of(document) : SectionMarkers.none();
        return new ParsedOutput(key, document, facts, selectors, sections);
    }

    public OutputKey key() {
        return key;
    }

    public String path() {
        return key.path();
    }

    /** The parsed document. Read it; never change it. */
    public Document document() {
        return document;
    }

    public HtmlFacts facts() {
        return facts;
    }

    /** The stable selector of {@code element} ({@link Selectors}). */
    public String selector(Element element) {
        return selectors.of(element);
    }

    /** The section instance that rendered {@code element}, when the document carries section markers. */
    public String sectionOf(Element element) {
        return sections.sectionOf(element);
    }
}
