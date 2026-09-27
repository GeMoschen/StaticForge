package com.acme.staticforge.redirect;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.acme.staticforge.common.SfException;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.junit.jupiter.params.provider.ValueSource;

class RedirectPathsTest {

    private static final String INDEX = "index.html";

    @ParameterizedTest
    @CsvSource({
        "products/hammer.html, products/hammer.html",
        "/products/hammer.html, products/hammer.html",
        "  /de/about/index.html  , de/about/index.html",
        "old/, old/index.html",
        "/, index.html",
        "a//b/./c.html, a/b/c.html",
        "%C3%BCber/uns.html, über/uns.html",
        "a%20b.html, a b.html",
        "c++.html, c++.html"
    })
    void normalizesSourcePaths(String raw, String expected) {
        assertThat(RedirectPaths.source(raw, INDEX, "fromPath")).isEqualTo(expected);
    }

    @Test
    void usesTheChannelsIndexFileForDirectories() {
        assertThat(RedirectPaths.source("docs/", "index.md", "fromPath")).isEqualTo("docs/index.md");
    }

    @ParameterizedTest
    @ValueSource(strings = {
        "", "   ", "../etc/passwd", "a/../../b.html", "%2E%2E/x.html", "https://example.com/a.html", "javascript:alert(1)",
        "//evil.example/x", "a\\b.html", "a.html?x=1", "a.html#top", "bad%zz.html", "bad%C3.html", "a/\u0001.html"
    })
    void refusesInvalidSourcePaths(String raw) {
        assertThatThrownBy(() -> RedirectPaths.source(raw, INDEX, "fromPath"))
                .isInstanceOf(SfException.class)
                .satisfies(e -> {
                    assertThat(((SfException) e).getProblem().getExtensions()).containsEntry("code", "SF-DOM-0193");
                    assertThat(((SfException) e).getProblem().getExtensions()).containsEntry("field", "fromPath");
                    assertThat(((SfException) e).getProblem().getStatus()).isEqualTo(422);
                });
    }

    @Test
    void refusesOverlongSourcePaths() {
        assertThatThrownBy(() -> RedirectPaths.source("a".repeat(RedirectPaths.MAX_PATH_LENGTH + 1), INDEX, "fromPath"))
                .isInstanceOf(SfException.class);
        assertThat(RedirectPaths.source("a".repeat(RedirectPaths.MAX_PATH_LENGTH), INDEX, "fromPath"))
                .hasSize(RedirectPaths.MAX_PATH_LENGTH);
    }

    @ParameterizedTest
    @CsvSource({
        "/new/page.html, new/page.html",
        "new/, new/index.html",
        "docs/api.html#auth, docs/api.html#auth",
        "/search.html?q=a, search.html?q=a",
        "https://example.com/x?y=1#z, https://example.com/x?y=1#z",
        "HTTP://Example.com, HTTP://Example.com"
    })
    void normalizesTargets(String raw, String expected) {
        assertThat(RedirectPaths.target(raw, INDEX, "toPath")).isEqualTo(expected);
    }

    @ParameterizedTest
    @ValueSource(strings = {
        "", "javascript:alert(1)", "data:text/html,x", "mailto:a@b.c", "ftp://example.com/a", "//example.com/a",
        "https://", "https:///nohost", "https://exa mple.com", "#top", "?q=1", "../up.html", "a.html#x y"
    })
    void refusesInvalidTargets(String raw) {
        assertThatThrownBy(() -> RedirectPaths.target(raw, INDEX, "toPath"))
                .isInstanceOf(SfException.class)
                .satisfies(e -> assertThat(((SfException) e).getProblem().getExtensions())
                        .containsEntry("code", "SF-DOM-0193")
                        .containsEntry("field", "toPath"));
    }

    @Test
    void pathOfStripsQueryAndFragmentAndIgnoresUrls() {
        assertThat(RedirectPaths.pathOf("docs/api.html#auth")).isEqualTo("docs/api.html");
        assertThat(RedirectPaths.pathOf("search.html?q=a#r")).isEqualTo("search.html");
        assertThat(RedirectPaths.pathOf("plain.html")).isEqualTo("plain.html");
        assertThat(RedirectPaths.pathOf("https://example.com/plain.html")).isNull();
        assertThat(RedirectPaths.pathOf(null)).isNull();
        assertThat(RedirectPaths.isAbsoluteUrl("https://example.com")).isTrue();
        assertThat(RedirectPaths.isAbsoluteUrl("example.com/a.html")).isFalse();
    }
}
