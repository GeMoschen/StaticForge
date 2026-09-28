package com.acme.staticforge.channel;

import static org.assertj.core.api.Assertions.assertThat;

import com.acme.staticforge.channel.ChannelOutputSettings.UrlStrategy;
import com.acme.staticforge.channel.OutputPathExpander.PageContext;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;
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

    // ------------------------------------------------------------------
    // Folder start pages (M31)
    // ------------------------------------------------------------------

    @Test
    void aStartPageRendersAtItsFoldersIndexPathIgnoringTheTemplatesOutputPath() {
        ObjectNode template = JsonNodeFactory.instance.objectNode();
        template.putObject("outputPath").put("html", "landing/{displayNameSlug}.{ext}");
        PageContext asOrdinary = new PageContext("homepage", "Homepage", "/pages_root/", payload(), template);
        PageContext asStartPage = new PageContext("homepage", "Homepage", "/pages_root/", payload(), template, true, true);
        PageContext inSubfolder = new PageContext("overview", "Overview", "/pages_root/products/", payload(), template, true, true);

        assertThat(OutputPathExpander.resolvePath(asOrdinary, "html", HTML)).isEqualTo("landing/homepage.html");
        assertThat(OutputPathExpander.resolvePath(asStartPage, "html", HTML)).isEqualTo("index.html");
        assertThat(OutputPathExpander.resolveUrl(asStartPage, "html", HTML)).isEqualTo("index.html");
        assertThat(OutputPathExpander.resolvePath(inSubfolder, "html", HTML)).isEqualTo("products/index.html");
        assertThat(OutputPathExpander.effectiveExpression(asStartPage, "html", false)).isEqualTo(OutputPathExpander.DEFAULT_EXPRESSION);
    }

    @Test
    void aPathOverrideStillWinsOverTheStartPage() {
        ObjectNode payload = payload();
        payload.putObject("output").putObject("pathOverride").put("html", "welcome/{uid}.{ext}");
        PageContext startPage = new PageContext("homepage", "Homepage", "/pages_root/", payload, null, true, true);

        // The override decides the path; its {uid} is the index stem, as for today's indexUid page.
        assertThat(OutputPathExpander.resolvePath(startPage, "html", HTML)).isEqualTo("welcome/index.html");
    }

    @Test
    void theIndexUidPageIsAnOrdinaryPageNextToAStartPage() {
        ChannelOutputSettings home = ChannelOutputSettings.of("html", null, JsonNodeFactory.instance.objectNode().put("indexUid", "home"));
        PageContext alone = new PageContext("home", "Home", "/pages_root/", payload(), null);
        PageContext nextToStartPage = new PageContext("home", "Home", "/pages_root/", payload(), null, false, true);

        assertThat(OutputPathExpander.resolvePath(alone, "html", home)).isEqualTo("index.html");
        assertThat(OutputPathExpander.resolvePath(nextToStartPage, "html", home)).isEqualTo("home.html");
    }

    @Test
    void aStartPageImpliesItsFolderHasOne() {
        PageContext startPage = new PageContext("homepage", "Homepage", "/pages_root/", payload(), null, true, false);

        assertThat(startPage.folderHasStartPage()).isTrue();
    }

    @Test
    void aStartPageFollowsTheDirectoryFormAndTheIndexFileName() {
        ChannelOutputSettings pretty = new ChannelOutputSettings("html", null, null, UrlStrategy.PRETTY, true);
        ChannelOutputSettings custom = ChannelOutputSettings.of(
                "html", "htm", JsonNodeFactory.instance.objectNode().put("indexFileName", "default.htm")
                        .put("urlStrategy", "PRETTY").put("trailingSlash", true));
        PageContext root = new PageContext("homepage", "Homepage", "/pages_root/", payload(), null, true, true);
        PageContext products = new PageContext("overview", "Overview", "/pages_root/products/", payload(), null, true, true);

        assertThat(OutputPathExpander.resolvePath(root, "html", pretty)).isEqualTo("index.html");
        assertThat(OutputPathExpander.resolveUrl(root, "html", pretty)).isEqualTo("./");
        assertThat(OutputPathExpander.resolvePath(products, "html", pretty)).isEqualTo("products/index.html");
        assertThat(OutputPathExpander.resolveUrl(products, "html", pretty)).isEqualTo("products/");
        assertThat(OutputPathExpander.resolvePath(products, "html", custom)).isEqualTo("products/default.htm");
        assertThat(OutputPathExpander.resolveUrl(products, "html", custom)).isEqualTo("products/");
    }

    @Test
    void aLocalizedStartPageGetsItsLanguagePrefixEvenWhenTheTemplatesExpressionHasNone() {
        ObjectNode template = JsonNodeFactory.instance.objectNode();
        template.putObject("outputPath").put("html", "{folder}{uid}.{ext}");
        PageContext startPage = new PageContext("homepage", "Homepage", "/pages_root/", payload(), template, true, true);

        assertThat(OutputPathExpander.resolvePath(startPage, "html", HTML, new OutputPathExpander.LocaleContext("de", "de")))
                .isEqualTo("de/index.html");
        assertThat(OutputPathExpander.resolvePath(startPage, "html", HTML, new OutputPathExpander.LocaleContext("en", "")))
                .isEqualTo("index.html");
        assertThat(OutputPathExpander.isLocaleDistinct(OutputPathExpander.effectiveExpression(startPage, "html", true))).isTrue();
    }

    @Test
    void pageTwoOfAStartPageIsTheIndexFilesSibling() {
        PageContext startPage = new PageContext("news", "News", "/pages_root/blog/", payload(), null, true, true);
        String first = OutputPathExpander.resolvePath(startPage, "html", HTML);

        assertThat(first).isEqualTo("blog/index.html");
        assertThat(OutputPathExpander.resolvePaginationPath(startPage, "html", HTML, first, 2)).isEqualTo("blog/index-2.html");
    }

    private static ObjectNode payload() {
        return JsonNodeFactory.instance.objectNode();
    }

    private static PageContext page(String folderPath, String uid) {
        return new PageContext(uid, uid, folderPath, JsonNodeFactory.instance.objectNode(), null);
    }
}
