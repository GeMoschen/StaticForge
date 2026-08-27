package com.acme.staticforge.channel;

import static org.assertj.core.api.Assertions.assertThat;

import com.acme.staticforge.channel.OutputPathExpander.PageContext;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import org.junit.jupiter.api.Test;

/**
 * Unit coverage for {@link OutputPathExpander}'s {@code relativeFolder} placeholder-expansion
 * step, focused on the {@code PAGES}-scope fixed "All Pages" wrapper root (mirrors {@code
 * NAVIGATION}/{@code TEMPLATES}'s own fixed roots) introduced alongside this task: the wrapper
 * must be exactly as invisible to a page's generated URL as the project's hidden root itself,
 * so giving every page store a fixed root folder never changes a single existing page's path.
 */
class OutputPathExpanderTest {

    @Test
    void pageDirectlyUnderThePagesRootWrapperResolvesTheSameAsAPageAtTheBareRoot() {
        PageContext atWrapperRoot = page("/pages_root/", "hammer-drill");
        PageContext atBareRoot = page("/", "hammer-drill");

        String wrapperPath = OutputPathExpander.resolvePath(atWrapperRoot, "html", null, false, "DEFAULT");
        String barePath = OutputPathExpander.resolvePath(atBareRoot, "html", null, false, "DEFAULT");

        assertThat(wrapperPath).isEqualTo("hammer-drill.html");
        assertThat(wrapperPath).isEqualTo(barePath);
    }

    @Test
    void pageInARealSubfolderOfThePagesRootWrapperKeepsOnlyItsOwnSubfolderSegment() {
        PageContext nested = page("/pages_root/products/", "hammer-drill");

        String path = OutputPathExpander.resolvePath(nested, "html", null, false, "DEFAULT");

        assertThat(path).isEqualTo("products/hammer-drill.html");
    }

    private static PageContext page(String folderPath, String uid) {
        return new PageContext(uid, uid, folderPath, JsonNodeFactory.instance.objectNode(), null);
    }
}
