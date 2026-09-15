package com.acme.staticforge.generate.render;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

/** Links in generated output are relative to the page being rendered ({@link GenerationRenderer#relativeUrl}). */
class GenerationRendererRelativeUrlTest {

    @Test
    void linksFromARootPageAreTheSitePaths() {
        assertThat(GenerationRenderer.relativeUrl("p1.html", "p1.html")).isEqualTo("p1.html");
        assertThat(GenerationRenderer.relativeUrl("p1.html", "pf/p2.html")).isEqualTo("pf/p2.html");
        assertThat(GenerationRenderer.relativeUrl("index.html", "media/logo.png")).isEqualTo("media/logo.png");
    }

    @Test
    void linksFromNestedPagesClimbToTheCommonAncestor() {
        assertThat(GenerationRenderer.relativeUrl("pf/pf1/p3.html", "p1.html")).isEqualTo("../../p1.html");
        assertThat(GenerationRenderer.relativeUrl("pf/pf1/p3.html", "pf/p2.html")).isEqualTo("../p2.html");
        assertThat(GenerationRenderer.relativeUrl("pf/pf1/p3.html", "pf/pf1/p3.html")).isEqualTo("p3.html");
        assertThat(GenerationRenderer.relativeUrl("pf/p2.html", "pf/pf1/p3.html")).isEqualTo("pf1/p3.html");
        assertThat(GenerationRenderer.relativeUrl("pf/p2.html", "other/x.html")).isEqualTo("../other/x.html");
        // A same-named folder at a different position is not a shared ancestor.
        assertThat(GenerationRenderer.relativeUrl("a/pf/x.html", "pf/y.html")).isEqualTo("../../pf/y.html");
    }

    @Test
    void directoryTargetsKeepTheirTrailingSlash() {
        assertThat(GenerationRenderer.relativeUrl("products/hammer/index.html", "products/drill/")).isEqualTo("../drill/");
        assertThat(GenerationRenderer.relativeUrl("products/hammer/index.html", "products/hammer/")).isEqualTo("./");
        assertThat(GenerationRenderer.relativeUrl("pf/pf1/p3.html", "./")).isEqualTo("../../");
        assertThat(GenerationRenderer.relativeUrl("p1.html", "./")).isEqualTo("./");
    }

    @Test
    void absoluteOrBlankTargetsAreUnchanged() {
        assertThat(GenerationRenderer.relativeUrl("pf/p2.html", "/custom/page.html")).isEqualTo("/custom/page.html");
        assertThat(GenerationRenderer.relativeUrl("pf/p2.html", "//cdn.example.com/x.js")).isEqualTo("//cdn.example.com/x.js");
        assertThat(GenerationRenderer.relativeUrl("pf/p2.html", "https://example.com/a")).isEqualTo("https://example.com/a");
        assertThat(GenerationRenderer.relativeUrl("pf/p2.html", "mailto:team@example.com")).isEqualTo("mailto:team@example.com");
        assertThat(GenerationRenderer.relativeUrl("pf/p2.html", "#top")).isEqualTo("#top");
        assertThat(GenerationRenderer.relativeUrl("pf/p2.html", "")).isEmpty();
        assertThat(GenerationRenderer.relativeUrl("pf/p2.html", null)).isEmpty();
    }
}
