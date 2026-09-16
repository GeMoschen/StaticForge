package com.acme.staticforge.channel;

import static org.assertj.core.api.Assertions.assertThat;

import com.acme.staticforge.channel.ChannelOutputSettings.UrlStrategy;
import com.acme.staticforge.channel.OutputPathExpander.PageContext;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import org.junit.jupiter.api.Test;

/**
 * Unit coverage for {@link OutputPathExpander}: the {@code PAGES}-scope fixed "All Pages" wrapper
 * root must be exactly as invisible to a page's generated URL as the project's hidden root itself,
 * and the channel's {@link ChannelOutputSettings} drive extension, index handling and the
 * RELATIVE/PRETTY URL forms.
 */
class OutputPathExpanderTest {

    private static final ChannelOutputSettings HTML = ChannelOutputSettings.defaults("html");

    @Test
    void pageDirectlyUnderThePagesRootWrapperResolvesTheSameAsAPageAtTheBareRoot() {
        PageContext atWrapperRoot = page("/pages_root/", "hammer-drill");
        PageContext atBareRoot = page("/", "hammer-drill");

        String wrapperPath = OutputPathExpander.resolvePath(atWrapperRoot, "html", HTML);
        String barePath = OutputPathExpander.resolvePath(atBareRoot, "html", HTML);

        assertThat(wrapperPath).isEqualTo("hammer-drill.html");
        assertThat(wrapperPath).isEqualTo(barePath);
    }

    @Test
    void pageInARealSubfolderOfThePagesRootWrapperKeepsOnlyItsOwnSubfolderSegment() {
        PageContext nested = page("/pages_root/products/", "hammer-drill");

        String path = OutputPathExpander.resolvePath(nested, "html", HTML);

        assertThat(path).isEqualTo("products/hammer-drill.html");
    }

    @Test
    void relativeStrategyLinksToTheFile() {
        PageContext about = page("/pages_root/", "about");

        assertThat(OutputPathExpander.resolvePath(about, "html", HTML)).isEqualTo("about.html");
        assertThat(OutputPathExpander.resolveUrl(about, "html", HTML)).isEqualTo("about.html");
    }

    @Test
    void prettyWithTrailingSlashWritesADirectoryAndLinksToIt() {
        ChannelOutputSettings pretty = new ChannelOutputSettings("html", null, null, UrlStrategy.PRETTY, true);
        PageContext about = page("/pages_root/company/", "about");
        PageContext index = page("/pages_root/", "index");

        assertThat(OutputPathExpander.resolvePath(about, "html", pretty)).isEqualTo("company/about/index.html");
        assertThat(OutputPathExpander.resolveUrl(about, "html", pretty)).isEqualTo("company/about/");
        assertThat(OutputPathExpander.resolvePath(index, "html", pretty)).isEqualTo("index.html");
        assertThat(OutputPathExpander.resolveUrl(index, "html", pretty)).isEqualTo("./");
    }

    @Test
    void prettyWithoutTrailingSlashBehavesLikeRelative() {
        ChannelOutputSettings pretty = new ChannelOutputSettings("html", null, null, UrlStrategy.PRETTY, false);
        PageContext about = page("/pages_root/", "about");

        assertThat(OutputPathExpander.resolvePath(about, "html", pretty)).isEqualTo("about.html");
        assertThat(OutputPathExpander.resolveUrl(about, "html", pretty)).isEqualTo("about.html");
    }

    @Test
    void customFileExtensionReplacesTheKeyDerivedOne() {
        ChannelOutputSettings htm = ChannelOutputSettings.of("html", "htm", null);

        assertThat(OutputPathExpander.resolvePath(page("/", "about"), "html", htm)).isEqualTo("about.htm");
        assertThat(OutputPathExpander.resolvePath(page("/", "index"), "html", htm)).isEqualTo("index.htm");
    }

    @Test
    void customIndexUidAndIndexFileName() {
        ChannelOutputSettings settings = ChannelOutputSettings.of(
                "html",
                "htm",
                JsonNodeFactory.instance.objectNode()
                        .put("indexUid", "home")
                        .put("indexFileName", "default.htm")
                        .put("urlStrategy", "PRETTY")
                        .put("trailingSlash", true));

        assertThat(OutputPathExpander.resolvePath(page("/pages_root/docs/", "home"), "html", settings))
                .isEqualTo("docs/default.htm");
        assertThat(OutputPathExpander.resolveUrl(page("/pages_root/docs/", "home"), "html", settings))
                .isEqualTo("docs/");
        assertThat(OutputPathExpander.resolvePath(page("/pages_root/docs/", "intro"), "html", settings))
                .isEqualTo("docs/intro/default.htm");
    }

    @Test
    void markdownChannelFallsBackToMdAndItsOwnIndexFile() {
        ChannelOutputSettings markdown = ChannelOutputSettings.of(
                "markdown", "", JsonNodeFactory.instance.objectNode().put("urlStrategy", "PRETTY").put("trailingSlash", true));

        assertThat(markdown.extension()).isEqualTo("md");
        assertThat(OutputPathExpander.resolvePath(page("/", "about"), "markdown", markdown)).isEqualTo("about/index.md");
    }

    private static PageContext page(String folderPath, String uid) {
        return new PageContext(uid, uid, folderPath, JsonNodeFactory.instance.objectNode(), null);
    }
}
