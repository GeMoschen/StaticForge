package com.acme.staticforge.channel;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

/** A registered URL maps back to exactly the path it was made from (M32.3), so the registry can decide the file. */
class OutputPathExpanderUrlTest {

    private static final ChannelOutputSettings PLAIN = ChannelOutputSettings.defaults("html");
    private static final ChannelOutputSettings PRETTY =
            new ChannelOutputSettings("html", null, null, ChannelOutputSettings.UrlStrategy.PRETTY, true);

    @Test
    void directoryUrlsNameTheIndexFile() {
        assertThat(OutputPathExpander.urlForOutput("products/hammer/index.html", PRETTY)).isEqualTo("products/hammer/");
        assertThat(OutputPathExpander.urlForOutput("index.html", PRETTY)).isEqualTo("./");
        assertThat(OutputPathExpander.pathForUrl("products/hammer/", PRETTY)).isEqualTo("products/hammer/index.html");
        assertThat(OutputPathExpander.pathForUrl("./", PRETTY)).isEqualTo("index.html");
    }

    @Test
    void aFileUrlIsItsPathInEveryChannel() {
        assertThat(OutputPathExpander.urlForOutput("blog/index-2.html", PRETTY)).isEqualTo("blog/index-2.html");
        assertThat(OutputPathExpander.urlForOutput("products/hammer/index.html", PLAIN))
                .isEqualTo("products/hammer/index.html");
        assertThat(OutputPathExpander.pathForUrl("team/about.html", PRETTY)).isEqualTo("team/about.html");
    }

    @Test
    void urlAndPathRoundTrip() {
        for (String path : new String[] {"index.html", "a/index.html", "a/b.html", "a/index-3.html"}) {
            for (ChannelOutputSettings settings : new ChannelOutputSettings[] {PLAIN, PRETTY}) {
                assertThat(OutputPathExpander.pathForUrl(OutputPathExpander.urlForOutput(path, settings), settings))
                        .isEqualTo(path);
            }
        }
    }
}
