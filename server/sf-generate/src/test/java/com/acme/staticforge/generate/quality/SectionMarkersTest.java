package com.acme.staticforge.generate.quality;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

/** Mapping elements to the section instance that rendered them ({@link SectionMarkers}, epic decision 13). */
class SectionMarkersTest {

    private static ParsedOutput parse(String html) {
        return ParsedOutput.parse(
                new OutputKey("index.html", null, "html", null, null), html, new LinkResolver("", "index.html"));
    }

    @Test
    void anElementMapsToTheInnermostEnclosingSection() {
        ParsedOutput output = parse("<html><body><h1>Page</h1>"
                + SectionMarkers.open("s-1") + "<div class=\"hero\"><img src=\"a.png\">"
                + SectionMarkers.open("s-1-card") + "<p class=\"card\"><img src=\"b.png\"></p>" + SectionMarkers.close()
                + "<p class=\"after\">x</p></div>" + SectionMarkers.close()
                + SectionMarkers.open("s-2") + "<img src=\"c.png\">" + SectionMarkers.close()
                + "<footer>f</footer></body></html>");
        var document = output.document();

        assertThat(output.sectionOf(document.selectFirst("h1"))).isNull();
        assertThat(output.sectionOf(document.selectFirst("div.hero"))).isEqualTo("s-1");
        assertThat(output.sectionOf(document.selectFirst("img[src=a.png]"))).isEqualTo("s-1");
        assertThat(output.sectionOf(document.selectFirst("p.card"))).isEqualTo("s-1-card");
        assertThat(output.sectionOf(document.selectFirst("img[src=b.png]"))).isEqualTo("s-1-card");
        assertThat(output.sectionOf(document.selectFirst("p.after"))).as("after the nested section closed").isEqualTo("s-1");
        assertThat(output.sectionOf(document.selectFirst("img[src=c.png]"))).isEqualTo("s-2");
        assertThat(output.sectionOf(document.selectFirst("footer"))).isNull();
    }

    @Test
    void aDocumentWithoutMarkersMapsNothing() {
        ParsedOutput output = parse("<html><body><!-- a comment --><img src=\"a.png\"></body></html>");

        assertThat(output.sectionOf(output.document().selectFirst("img"))).isNull();
        assertThat(SectionMarkers.present("<p>x</p>")).isFalse();
        assertThat(SectionMarkers.present(SectionMarkers.open("x"))).isTrue();
    }

    @Test
    void anUnbalancedCloseIsIgnored() {
        ParsedOutput output = parse("<body>" + SectionMarkers.close() + "<p>x</p>" + SectionMarkers.open("s") + "<i>y</i></body>");

        assertThat(output.sectionOf(output.document().selectFirst("p"))).isNull();
        assertThat(output.sectionOf(output.document().selectFirst("i"))).isEqualTo("s");
    }
}
