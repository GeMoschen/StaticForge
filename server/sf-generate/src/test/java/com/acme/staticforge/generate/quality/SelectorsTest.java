package com.acme.staticforge.generate.quality;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import org.jsoup.Jsoup;
import org.jsoup.nodes.Document;
import org.jsoup.nodes.Element;
import org.jsoup.parser.Parser;
import org.junit.jupiter.api.Test;

/** Stable, short selectors for finding locations ({@link Selectors}, M30.1.1). */
class SelectorsTest {

    private static final String HTML = """
            <!doctype html>
            <html><head><title>T</title><meta name="description" content="d"></head>
            <body>
              <header><img src="logo.png"></header>
              <main id="content">
                <p>one</p>
                <p>two <img src="a.png"> <img src="b.png"></p>
                <div id="dup"><span>x</span></div>
                <div id="dup"><span>y</span></div>
                <div id="1st"><a href="#">z</a></div>
              </main>
            </body></html>
            """;

    private static Document parse() {
        return Jsoup.parse(HTML, "", Parser.htmlParser());
    }

    private static List<String> selectorsOfEveryElement(Document document) {
        Selectors selectors = Selectors.of(document);
        return document.getAllElements().stream().skip(1).map(selectors::of).toList();
    }

    @Test
    void selectorsAreShortPathsFromTheNearestUniqueId() {
        Document document = parse();
        Selectors selectors = Selectors.of(document);

        assertThat(selectors.of(document.select("header img").first())).isEqualTo("body > header > img");
        assertThat(selectors.of(document.select("main p img").get(1))).isEqualTo("main#content > p:nth-of-type(2) > img:nth-of-type(2)");
        assertThat(selectors.of(document.selectFirst("main"))).isEqualTo("main#content");
        assertThat(selectors.of(document.selectFirst("meta"))).isEqualTo("head > meta");
        assertThat(selectors.of(document.selectFirst("html"))).isEqualTo("html");
        assertThat(selectors.of(document.select("div span").get(1)))
                .as("a duplicate id is no anchor")
                .isEqualTo("main#content > div:nth-of-type(2) > span");
        assertThat(selectors.of(document.selectFirst("a")))
                .as("an id that isn't a plain identifier is skipped, not escaped")
                .isEqualTo("main#content > div:nth-of-type(3) > a");
    }

    @Test
    void everySelectorSelectsExactlyItsElement() {
        Document document = parse();
        Selectors selectors = Selectors.of(document);
        for (Element element : document.getAllElements().stream().skip(1).toList()) {
            String selector = selectors.of(element);
            if (selector.contains("#dup")) {
                continue;
            }
            assertThat(document.select(selector)).as(selector).containsExactly(element);
        }
    }

    @Test
    void selectorsAreStableAcrossTwoParsesOfTheSameDocument() {
        assertThat(selectorsOfEveryElement(parse())).isEqualTo(selectorsOfEveryElement(parse()));
    }
}
