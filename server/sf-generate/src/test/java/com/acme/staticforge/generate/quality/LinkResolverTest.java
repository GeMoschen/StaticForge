package com.acme.staticforge.generate.quality;

import static org.assertj.core.api.Assertions.assertThat;

import com.acme.staticforge.generate.quality.LinkResolver.Target;
import org.junit.jupiter.api.Test;

/** Resolution of the URLs written in an output against the build ({@link LinkResolver}, M30.1.1, epic decision 1). */
class LinkResolverTest {

    private final LinkResolver resolver = new LinkResolver("https://example.com", "index.html");

    @Test
    void relativeLinksResolveAgainstTheOutputsOwnDirectory() {
        assertThat(resolver.resolve("pf/pf1/p3.html", "../../p1.html")).isEqualTo(new Target("p1.html", null));
        assertThat(resolver.resolve("pf/pf1/p3.html", "../p2.html")).isEqualTo(new Target("pf/p2.html", null));
        assertThat(resolver.resolve("pf/pf1/p3.html", "p4.html")).isEqualTo(new Target("pf/pf1/p4.html", null));
        assertThat(resolver.resolve("index.html", "assets/media/logo.png"))
                .isEqualTo(new Target("assets/media/logo.png", null));
        assertThat(resolver.resolve("a/b.html", "./c/./d.html")).isEqualTo(new Target("a/c/d.html", null));
        assertThat(resolver.resolve("a/b.html", "c//d.html")).as("empty segments collapse").isEqualTo(new Target("a/c/d.html", null));
    }

    @Test
    void rootRelativeLinksResolveAgainstTheSiteRoot() {
        assertThat(resolver.resolve("pf/p2.html", "/p1.html")).isEqualTo(new Target("p1.html", null));
        assertThat(resolver.resolve("pf/p2.html", "/de/about.html")).isEqualTo(new Target("de/about.html", null));
        assertThat(resolver.resolve("pf/p2.html", "/")).isEqualTo(new Target("index.html", null));
    }

    @Test
    void rootRelativeLinksUnderABaseUrlPathMustStayBelowIt() {
        LinkResolver docs = new LinkResolver("https://example.com/docs/", "index.html");
        assertThat(docs.resolve("a.html", "/docs/b.html")).isEqualTo(new Target("b.html", null));
        assertThat(docs.resolve("a.html", "/docs/")).isEqualTo(new Target("index.html", null));
        assertThat(docs.resolve("a.html", "/docs/../docs/c.html")).isEqualTo(new Target("c.html", null));
        assertThat(docs.resolve("a.html", "/other/b.html")).as("outside the site").isNull();
        assertThat(docs.resolve("a.html", "/docsx/b.html")).as("a sibling path is not below it").isNull();
        assertThat(docs.resolve("a.html", "https://example.com/docs/b.html")).isEqualTo(new Target("b.html", null));
        assertThat(docs.resolve("a.html", "https://example.com/docs")).isEqualTo(new Target("index.html", null));
        assertThat(docs.resolve("a.html", "https://example.com/b.html")).isNull();
    }

    @Test
    void absoluteUrlsAreInternalOnlyUnderTheBaseUrl() {
        assertThat(resolver.resolve("pf/p2.html", "https://example.com/p1.html")).isEqualTo(new Target("p1.html", null));
        assertThat(resolver.resolve("pf/p2.html", "HTTPS://Example.COM/p1.html"))
                .as("scheme and host compare case-insensitively")
                .isEqualTo(new Target("p1.html", null));
        assertThat(resolver.resolve("pf/p2.html", "http://example.com/pf/")).isEqualTo(new Target("pf/index.html", null));
        assertThat(resolver.resolve("pf/p2.html", "https://example.com")).isEqualTo(new Target("index.html", null));
        assertThat(resolver.resolve("pf/p2.html", "//example.com/p1.html")).as("protocol-relative")
                .isEqualTo(new Target("p1.html", null));
        assertThat(resolver.resolve("pf/p2.html", "https://example.org/p1.html")).isNull();
        assertThat(resolver.resolve("pf/p2.html", "https://example.com.evil.org/p1.html")).isNull();
        assertThat(resolver.resolve("pf/p2.html", "//cdn.example.com/x.js")).isNull();
        assertThat(new LinkResolver("", "index.html").resolve("a.html", "https://example.com/p1.html"))
                .as("without a baseUrl every absolute URL is external")
                .isNull();
    }

    @Test
    void prettyUrlsResolveToTheChannelsIndexFile() {
        assertThat(resolver.resolve("products/hammer/index.html", "../drill/"))
                .isEqualTo(new Target("products/drill/index.html", null));
        assertThat(resolver.resolve("products/hammer/index.html", "./")).isEqualTo(new Target("products/hammer/index.html", null));
        assertThat(resolver.resolve("pf/pf1/p3.html", "../../")).isEqualTo(new Target("index.html", null));
        assertThat(resolver.resolve("a/b.html", "..")).isEqualTo(new Target("index.html", null));
        assertThat(new LinkResolver("", "default.htm").resolve("a/b.htm", "c/"))
                .isEqualTo(new Target("a/c/default.htm", null));
    }

    @Test
    void fragmentsAreSplitOffAndDecoded() {
        assertThat(resolver.resolve("a/b.html", "c.html#part-2")).isEqualTo(new Target("a/c.html", "part-2"));
        assertThat(resolver.resolve("a/b.html", "#top")).as("same page").isEqualTo(new Target("a/b.html", "top"));
        assertThat(resolver.resolve("a/b.html", "#")).isEqualTo(new Target("a/b.html", ""));
        assertThat(resolver.resolve("a/b.html", "c.html#caf%C3%A9")).isEqualTo(new Target("a/c.html", "café"));
        assertThat(resolver.resolve("a/b.html", "../#x")).isEqualTo(new Target("index.html", "x"));
    }

    @Test
    void queriesAreIgnored() {
        assertThat(resolver.resolve("a/b.html", "c.html?page=2")).isEqualTo(new Target("a/c.html", null));
        assertThat(resolver.resolve("a/b.html", "c.html?x=1#y")).isEqualTo(new Target("a/c.html", "y"));
        assertThat(resolver.resolve("a/b.html", "?page=2")).isEqualTo(new Target("a/b.html", null));
    }

    @Test
    void encodedCharactersAreDecoded() {
        assertThat(resolver.resolve("index.html", "caf%C3%A9/menu%20card.html"))
                .isEqualTo(new Target("café/menu card.html", null));
        assertThat(resolver.resolve("index.html", "a+b.html")).as("a plus stays a plus").isEqualTo(new Target("a+b.html", null));
        assertThat(resolver.resolve("index.html", "100%.html")).as("a lone percent stays").isEqualTo(new Target("100%.html", null));
        assertThat(resolver.resolve("index.html", "%2e%2e/x.html")).as("encoded dots still climb").isNull();
    }

    @Test
    void escapingTheSiteRootResolvesToNothing() {
        assertThat(resolver.resolve("a.html", "../x.html")).isNull();
        assertThat(resolver.resolve("pf/p2.html", "../../x.html")).isNull();
        assertThat(resolver.resolve("pf/p2.html", "/../x.html")).isNull();
        assertThat(resolver.resolve("pf/p2.html", "https://example.com/../x.html")).isNull();
    }

    @Test
    void otherSchemesAndEmptyUrlsAreSkipped() {
        assertThat(resolver.resolve("a.html", "mailto:team@example.com")).isNull();
        assertThat(resolver.resolve("a.html", "tel:+49301234")).isNull();
        assertThat(resolver.resolve("a.html", "data:image/png;base64,AAAA")).isNull();
        assertThat(resolver.resolve("a.html", "javascript:void(0)")).isNull();
        assertThat(resolver.resolve("a.html", "ftp://example.com/a.html")).isNull();
        assertThat(resolver.resolve("a.html", "")).isNull();
        assertThat(resolver.resolve("a.html", "   ")).isNull();
        assertThat(resolver.resolve("a.html", null)).isNull();
    }

    @Test
    void surroundingWhitespaceIsIgnored() {
        assertThat(resolver.resolve("a/b.html", "  c.html \n")).isEqualTo(new Target("a/c.html", null));
    }
}
