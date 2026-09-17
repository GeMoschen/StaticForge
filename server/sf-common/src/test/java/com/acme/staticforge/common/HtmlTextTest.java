package com.acme.staticforge.common;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

class HtmlTextTest {

    @Test
    void stripsTagsBetweenWords() {
        assertThat(HtmlText.toPlainText("<p>Hello <strong>world</strong></p>")).isEqualTo("Hello world");
        assertThat(HtmlText.toPlainText("<p>one</p><p>two</p>")).isEqualTo("one two");
    }

    @Test
    void inlineTagsDoNotSplitWords() {
        assertThat(HtmlText.toPlainText("<p>a <strong>quokka</strong>.</p>")).isEqualTo("a quokka.");
        assertThat(HtmlText.toPlainText("<b>Ha</b>us <A HREF=\"x\">link</A>ed")).isEqualTo("Haus linked");
        assertThat(HtmlText.toPlainText("line<br>break <bold>not inline</bold>")).isEqualTo("line break not inline");
        assertThat(HtmlText.toPlainText("<span	class=\"x\">tab</span>bed")).isEqualTo("tabbed");
    }

    @Test
    void decodesCharacterReferences() {
        assertThat(HtmlText.toPlainText("Fish &amp; chips&nbsp;&lt;3 &quot;x&quot; &#39;y&#39;"))
                .isEqualTo("Fish & chips <3 \"x\" 'y'");
        assertThat(HtmlText.toPlainText("It&#8217;s &#x1F600; H&auml;user")).isEqualTo("It’s 😀 Häuser");
    }

    @Test
    void keepsUnknownOrInvalidReferences() {
        assertThat(HtmlText.toPlainText("&bogus; &#0; &#xD800; &")).isEqualTo("&bogus; &#0; &#xD800; &");
    }

    @Test
    void dropsScriptAndStyleContent() {
        assertThat(HtmlText.toPlainText("<p>a</p><script>alert('x')</script><style>p{}</style><p>b</p>"))
                .isEqualTo("a b");
    }

    @Test
    void handlesNullAndEmpty() {
        assertThat(HtmlText.toPlainText(null)).isEmpty();
        assertThat(HtmlText.toPlainText("")).isEmpty();
    }
}
