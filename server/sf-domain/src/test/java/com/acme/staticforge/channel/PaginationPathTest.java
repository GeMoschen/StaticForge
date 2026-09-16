package com.acme.staticforge.channel;

import static org.assertj.core.api.Assertions.assertThat;

import com.acme.staticforge.channel.ChannelOutputSettings.UrlStrategy;
import com.acme.staticforge.channel.OutputPathExpander.PageContext;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.junit.jupiter.api.Test;

/** Output paths and URLs of pages 2..N of a paginated page (M21.2.1). */
class PaginationPathTest {

    private static final ChannelOutputSettings RELATIVE = ChannelOutputSettings.defaults("html");
    private static final ChannelOutputSettings PRETTY = new ChannelOutputSettings("html", null, null, UrlStrategy.PRETTY, true);

    @Test
    void defaultsToSiblingFilesInEveryChannel() {
        PageContext blog = page("/news/", "blog", null);

        String relative = OutputPathExpander.resolvePath(blog, "html", RELATIVE);
        String pretty = OutputPathExpander.resolvePath(blog, "html", PRETTY);

        assertThat(relative).isEqualTo("news/blog.html");
        assertThat(OutputPathExpander.resolvePaginationPath(blog, "html", RELATIVE, relative, 2)).isEqualTo("news/blog-2.html");
        assertThat(pretty).isEqualTo("news/blog/index.html");
        assertThat(OutputPathExpander.resolvePaginationPath(blog, "html", PRETTY, pretty, 3)).isEqualTo("news/blog/index-3.html");
    }

    @Test
    void anIndexPageAndAPathWithoutExtensionGetTheSuffix() {
        PageContext index = page("/blog/", "index", null);

        assertThat(OutputPathExpander.resolvePaginationPath(index, "html", RELATIVE, "blog/index.html", 2)).isEqualTo("blog/index-2.html");
        assertThat(OutputPathExpander.resolvePaginationPath(index, "html", RELATIVE, "feeds.v1/list", 2)).isEqualTo("feeds.v1/list-2");
    }

    @Test
    void expandsTheTemplatesPattern() {
        ObjectNode template = JsonNodeFactory.instance.objectNode();
        template.putObject("paginationPath")
                .put("html", "{pagePath}/page/{pageNumber}/index.{ext}")
                .put("markdown", "{folder}{uid}-p{pageNumber}.{ext}");
        PageContext blog = page("/news/", "blog", template);

        assertThat(OutputPathExpander.resolvePaginationPath(blog, "html", RELATIVE, "news/blog.html", 2))
                .isEqualTo("news/blog/page/2/index.html");
        assertThat(OutputPathExpander.resolvePaginationPath(blog, "markdown", ChannelOutputSettings.defaults("markdown"), "news/blog.md", 4))
                .isEqualTo("news/blog-p4.md");
        // A channel without a pattern keeps the default.
        assertThat(OutputPathExpander.resolvePaginationPath(blog, "amp", RELATIVE, "news/blog.html", 2)).isEqualTo("news/blog-2.html");
    }

    @Test
    void linksAnIndexFileAsItsDirectoryOnlyInDirectoryUrlChannels() {
        assertThat(OutputPathExpander.urlForPaginationPath("news/blog/index.html", PRETTY)).isEqualTo("news/blog/");
        assertThat(OutputPathExpander.urlForPaginationPath("news/blog/index-2.html", PRETTY)).isEqualTo("news/blog/index-2.html");
        assertThat(OutputPathExpander.urlForPaginationPath("news/blog/page/2/index.html", PRETTY)).isEqualTo("news/blog/page/2/");
        assertThat(OutputPathExpander.urlForPaginationPath("news/blog/index.html", RELATIVE)).isEqualTo("news/blog/index.html");
    }

    private static PageContext page(String folderPath, String uid, ObjectNode templatePayload) {
        return new PageContext(uid, uid, folderPath, JsonNodeFactory.instance.objectNode(), templatePayload);
    }
}
