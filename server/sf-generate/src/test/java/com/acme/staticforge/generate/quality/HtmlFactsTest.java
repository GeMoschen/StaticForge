package com.acme.staticforge.generate.quality;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.tuple;

import java.util.List;
import org.junit.jupiter.api.Test;

/** The facts one pass over a parsed output extracts ({@link HtmlFacts}, M30.1.1). */
class HtmlFactsTest {

    private final LinkResolver resolver = new LinkResolver("https://example.com", "index.html");

    private HtmlFacts facts(String path, String html) {
        return ParsedOutput.parse(new OutputKey(path, null, "html", null, null), html, resolver).facts();
    }

    @Test
    void extractsTheHeadFacts() {
        HtmlFacts facts = facts("de/news/index.html", """
                <!doctype html>
                <html lang="de-CH">
                <head>
                  <title>  Neuigkeiten
                     aus Bern </title>
                  <meta name="Description" content="Alles Neue.">
                  <meta name="robots" content="noindex">
                  <meta name="ROBOTS" content="nofollow">
                  <link rel="canonical" href="https://example.com/de/news/">
                  <link rel="alternate" hreflang="en" href="../../en/news/">
                  <link rel="ALTERNATE nofollow" hreflang="x-default" href="/en/news/index.html">
                  <link rel="alternate" type="application/rss+xml" href="feed.xml">
                </head>
                <body><h1>A</h1><section><h1>B</h1></section></body>
                </html>
                """);

        assertThat(facts.title()).isEqualTo("Neuigkeiten aus Bern");
        assertThat(facts.metaDescription()).isEqualTo("Alles Neue.");
        assertThat(facts.robotsMeta()).isEqualTo("noindex, nofollow");
        assertThat(facts.lang()).isEqualTo("de-CH");
        assertThat(facts.h1Count()).isEqualTo(2);
        assertThat(facts.canonical().resolvedPath()).isEqualTo("de/news/index.html");
        assertThat(facts.alternates())
                .extracting(HtmlFacts.Alternate::hreflang, alternate -> alternate.link().resolvedPath())
                .containsExactly(tuple("en", "en/news/index.html"), tuple("x-default", "en/news/index.html"));
    }

    @Test
    void absentHeadFactsAreNullNotEmpty() {
        HtmlFacts facts = facts("a.html", "<html><body><svg><title>Chart</title></svg><p>x</p></body></html>");

        assertThat(facts.title()).as("an svg title is not the document's").isNull();
        assertThat(facts.metaDescription()).isNull();
        assertThat(facts.robotsMeta()).isNull();
        assertThat(facts.lang()).isNull();
        assertThat(facts.canonical()).isNull();
        assertThat(facts.alternates()).isEmpty();
        assertThat(facts.h1Count()).isZero();

        HtmlFacts empty = facts("b.html", "<html lang=\"\"><head><title> </title><meta name=\"description\"></head></html>");
        assertThat(empty.title()).isEmpty();
        assertThat(empty.metaDescription()).isEmpty();
        assertThat(empty.lang()).isEmpty();
    }

    @Test
    void idsAreAMultisetAsWrittenAndAnchorsAreSeparate() {
        HtmlFacts facts = facts("a.html", """
                <body>
                  <div id="Top"></div><p id="intro"></p><span id="intro"></span><i id=""></i>
                  <a name="legacy">old</a><a name="">none</a>
                </body>
                """);

        assertThat(facts.ids()).containsExactly("Top", "intro", "intro");
        assertThat(facts.anchors()).containsExactly("legacy");
        assertThat(facts.hasTarget("Top")).isTrue();
        assertThat(facts.hasTarget("top")).as("ids are case-sensitive").isFalse();
        assertThat(facts.hasTarget("legacy")).isTrue();
        assertThat(facts.targets()).containsExactlyInAnyOrder("Top", "intro", "legacy");
        assertThat(facts.idsTruncated()).isFalse();
    }

    @Test
    void everyOutgoingReferenceIsResolved() {
        HtmlFacts facts = facts("pf/p2.html", """
                <html><head>
                  <link rel="stylesheet" href="../assets/site.css">
                  <script src="/assets/app.js"></script>
                </head><body>
                  <a href="p3.html#part">next</a>
                  <a href="mailto:team@example.com">mail</a>
                  <a href="">empty</a>
                  <a>no href</a>
                  <img src="../assets/media/a.png" alt="">
                  <iframe src="https://www.youtube.com/embed/x"></iframe>
                  <video src="clip.mp4" poster="poster.jpg"></video>
                  <audio src="/sound.mp3"></audio>
                  <picture><source src="s.webp" srcset="s-1.webp 1x, s-2.webp 2x"></picture>
                </body></html>
                """);

        assertThat(facts.links())
                .extracting(LinkRef::element, LinkRef::attribute, LinkRef::raw, LinkRef::resolvedPath, LinkRef::fragment)
                .containsExactly(
                        tuple("link", "href", "../assets/site.css", "assets/site.css", null),
                        tuple("script", "src", "/assets/app.js", "assets/app.js", null),
                        tuple("a", "href", "p3.html#part", "pf/p3.html", "part"),
                        tuple("a", "href", "mailto:team@example.com", null, null),
                        tuple("a", "href", "", null, null),
                        tuple("img", "src", "../assets/media/a.png", "assets/media/a.png", null),
                        tuple("iframe", "src", "https://www.youtube.com/embed/x", null, null),
                        tuple("video", "src", "clip.mp4", "pf/clip.mp4", null),
                        tuple("video", "poster", "poster.jpg", "pf/poster.jpg", null),
                        tuple("audio", "src", "/sound.mp3", "sound.mp3", null),
                        tuple("source", "src", "s.webp", "pf/s.webp", null),
                        tuple("source", "srcset", "s-1.webp", "pf/s-1.webp", null),
                        tuple("source", "srcset", "s-2.webp", "pf/s-2.webp", null));
        assertThat(facts.links()).allSatisfy(link -> assertThat(link.selector()).isNotBlank());
    }

    @Test
    void srcsetCandidatesWithDescriptorsAndCommas() {
        HtmlFacts facts = facts("index.html", """
                <img src="a.png" srcset="a-480.png 480w,a-800.png   800w , https://example.com/a,big.png 2x,
                     img/x.png">
                """);

        assertThat(facts.links()).extracting(LinkRef::attribute, LinkRef::resolvedPath).containsExactly(
                tuple("src", "a.png"),
                tuple("srcset", "a-480.png"),
                tuple("srcset", "a-800.png"),
                tuple("srcset", "a,big.png"),
                tuple("srcset", "img/x.png"));
        assertThat(HtmlFacts.srcsetUrls("a.png 1x (junk, more), b.png")).containsExactly("a.png", "b.png");
        assertThat(HtmlFacts.srcsetUrls(" , ,")).isEmpty();
        assertThat(HtmlFacts.srcsetUrls("a.png,b.png")).as("a URL may contain commas").containsExactly("a.png,b.png");
    }

    @Test
    void idsAndLinksAreCappedWithAFlag() {
        StringBuilder html = new StringBuilder("<body>");
        for (int i = 0; i < HtmlFacts.MAX_IDS + 5; i++) {
            html.append("<a id=\"i").append(i).append("\" href=\"p").append(i).append(".html\">x</a>");
        }
        HtmlFacts facts = facts("index.html", html + "</body>");

        assertThat(facts.ids()).hasSize(HtmlFacts.MAX_IDS);
        assertThat(facts.idsTruncated()).isTrue();
        assertThat(facts.links()).hasSize(HtmlFacts.MAX_LINKS);
        assertThat(facts.linksTruncated()).isTrue();
    }

    @Test
    void factsSurviveASidecarRoundTrip() throws Exception {
        HtmlFacts facts = facts("a/b.html", """
                <html lang="en"><head><title>T</title><link rel="canonical" href="b.html"></head>
                <body id="x"><a href="../c.html#y">c</a><img srcset="d.png 2x"></body></html>
                """);
        com.fasterxml.jackson.databind.ObjectMapper json = new com.fasterxml.jackson.databind.ObjectMapper();

        HtmlFacts read = json.readValue(json.writeValueAsBytes(facts), HtmlFacts.class);

        assertThat(read).isEqualTo(facts);
        assertThat(List.of(read.links().get(1).selector())).containsExactly(facts.links().get(1).selector());
    }
}
