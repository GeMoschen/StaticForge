package com.acme.staticforge.generate.render;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

/** Section markers of the draft-check render (M30.3.1): written in body text only, never where a comment isn't one. */
class SectionMarkerWriterTest {

    private static String section(String id, String html) {
        return SectionMarkerWriter.wrap(id, html);
    }

    @Test
    void sectionsInTheBodyGetMarkersAroundTheirOutput() {
        String html = "<html><head><title>T</title></head><body><main>" + section("s1", "<p>one</p>")
                + section("s2", "<figure><img src=\"a.png\"></figure>") + "</main></body></html>";

        assertThat(SectionMarkerWriter.finish(html)).isEqualTo("<html><head><title>T</title></head><body><main>"
                + "<!--sf:section s1--><p>one</p><!--/sf:section--><!--sf:section s2--><figure><img src=\"a.png\">"
                + "</figure><!--/sf:section--></main></body></html>");
    }

    @Test
    void nestedSectionsKeepTheirNesting() {
        String html = "<body>" + section("outer", "<div>" + section("inner", "<p>x</p>") + "</div>") + "</body>";

        assertThat(SectionMarkerWriter.finish(html)).isEqualTo("<body><!--sf:section outer--><div><!--sf:section inner-->"
                + "<p>x</p><!--/sf:section--></div><!--/sf:section--></body>");
    }

    @Test
    void aDocumentWithoutHtmlOrBodyTagsIsBodyText() {
        assertThat(SectionMarkerWriter.finish("<p>a</p>" + section("s1", "<p>b</p>")))
                .isEqualTo("<p>a</p><!--sf:section s1--><p>b</p><!--/sf:section-->");
    }

    @Test
    void aSectionRenderedInsideTheHeadGetsNoMarker() {
        String html = "<html><head>" + section("meta", "<meta name=\"description\" content=\"d\">")
                + "</head><body>" + section("s1", "<p>x</p>") + "</body></html>";

        assertThat(SectionMarkerWriter.finish(html)).isEqualTo("<html><head><meta name=\"description\" content=\"d\">"
                + "</head><body><!--sf:section s1--><p>x</p><!--/sf:section--></body></html>");
    }

    @Test
    void aSectionRenderedIntoAnAttributeOrATagGetsNoMarker() {
        String html = "<body><div title=\"" + section("attr", "text") + "\" " + section("tag", "data-x=\"1\"")
                + "><img alt='" + section("single", "a") + "'></div></body>";

        assertThat(SectionMarkerWriter.finish(html))
                .isEqualTo("<body><div title=\"text\" data-x=\"1\"><img alt='a'></div></body>");
    }

    @Test
    void aSectionRenderedIntoRawTextOrACommentGetsNoMarker() {
        String html = "<body><script>var s = '" + section("script", "<p>") + "';</script><style>"
                + section("style", "p{}") + "</style><textarea>" + section("area", "t") + "</textarea><!-- "
                + section("comment", "c") + " --><title>" + section("title", "x") + "</title>"
                + section("after", "<p>ok</p>") + "</body>";

        assertThat(SectionMarkerWriter.finish(html)).isEqualTo("<body><script>var s = '<p>';</script><style>p{}</style>"
                + "<textarea>t</textarea><!-- c --><title>x</title><!--sf:section after--><p>ok</p><!--/sf:section-->"
                + "</body>");
    }

    @Test
    void aScriptThatMentionsItsEndTagInAStringStillEndsAtItsRealEndTag() {
        String html = "<body><SCRIPT type=\"module\">let a = '</scripts>';</SCRIPT>" + section("s", "<p>x</p>")
                + "</body>";

        assertThat(SectionMarkerWriter.finish(html)).isEqualTo("<body><SCRIPT type=\"module\">let a = '</scripts>';"
                + "</SCRIPT><!--sf:section s--><p>x</p><!--/sf:section--></body>");
    }

    @Test
    void aPairIsKeptOnlyWhenBothEndsAreSafe() {
        // The section opens in the head and closes in the body: neither end is written.
        String html = "<html><head>" + SectionMarkerWriter.wrap("split", "<meta charset=\"utf-8\"></head><body><p>x</p>")
                + "</body></html>";

        assertThat(SectionMarkerWriter.finish(html))
                .isEqualTo("<html><head><meta charset=\"utf-8\"></head><body><p>x</p></body></html>");
    }

    @Test
    void anIdThatCouldBreakTheCommentIsNotMarked() {
        assertThat(SectionMarkerWriter.wrap("a--b", "<p>x</p>")).isEqualTo("<p>x</p>");
        assertThat(SectionMarkerWriter.wrap("a>b", "<p>x</p>")).isEqualTo("<p>x</p>");
        assertThat(SectionMarkerWriter.wrap("", "<p>x</p>")).isEqualTo("<p>x</p>");
        assertThat(SectionMarkerWriter.wrap(null, "<p>x</p>")).isEqualTo("<p>x</p>");
        assertThat(SectionMarkerWriter.finish(SectionMarkerWriter.wrap("3f2c0b1e-9a4d-4c55-8e0f-2b9d7c1a6e33", "<p>x</p>")))
                .isEqualTo("<!--sf:section 3f2c0b1e-9a4d-4c55-8e0f-2b9d7c1a6e33--><p>x</p><!--/sf:section-->");
    }

    @Test
    void aDocumentWithoutSentinelsIsReturnedUnchanged() {
        String html = "<html><head><title>T</title></head><body><!-- note --><p>x</p></body></html>";

        assertThat(SectionMarkerWriter.finish(html)).isSameAs(html);
    }
}
