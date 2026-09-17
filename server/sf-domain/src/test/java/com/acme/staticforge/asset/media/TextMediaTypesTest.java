package com.acme.staticforge.asset.media;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.io.IOException;
import java.io.InputStream;
import org.apache.tika.Tika;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.junit.jupiter.api.Test;

class TextMediaTypesTest {

    private final Tika tika = new Tika();

    /**
     * Real sample files through the same detection call as {@code MediaServiceImpl.sniff}: the
     * allow-list must cover what Tika reports, not what we assume. Detection is name-driven; without
     * a name every one of these (except SVG/XML) comes back {@code text/plain}, which is still text.
     */
    @ParameterizedTest
    @CsvSource({
        "sample.css, text/css",
        "sample.js, application/javascript",
        "sample.min.js, application/javascript",
        "sample.json, application/json",
        "site.webmanifest, application/manifest+json",
        "sample.svg, image/svg+xml",
        "sample.txt, text/plain",
        "sample.xml, application/xml",
    })
    void tikaDetectsSamplesAsAllowListedText(String file, String expectedMime) throws IOException {
        String detected = tika.detect(sample(file), file);

        assertThat(detected).isEqualTo(expectedMime);
        assertThat(TextMediaTypes.isText(detected)).isTrue();
    }

    /**
     * What Tika reports for other everyday text files, by name and by content: every one of them is text media, so the
     * process toggle shows, and each publishes with a text extension (never {@code .bin}).
     */
    @ParameterizedTest
    @CsvSource({
        "robots.txt, 'User-agent: *\nDisallow:\n', text/x-robots, txt",
        "readme.md, '# Title\n', text/x-web-markdown, md",
        "data.csv, 'a,b\n1,2\n', text/csv, csv",
        "page.html, '<p>$CMS_VALUE(x)$</p>', text/html, html",
        "data.yaml, 'key: value\n', text/x-yaml, yaml",
        "feed.rss, '<rss></rss>', application/rss+xml, rss",
        "feed.atom, '<feed></feed>', application/atom+xml, atom",
        "track.vtt, 'WEBVTT\n', text/vtt, vtt",
    })
    void everydayTextFilesAreTextMedia(String file, String content, String expectedMime, String extension) {
        String detected = tika.detect(content.replace("\\n", "\n").getBytes(java.nio.charset.StandardCharsets.UTF_8), file);

        assertThat(detected).isEqualTo(expectedMime);
        assertThat(TextMediaTypes.isText(detected)).isTrue();
        assertThat(MediaPaths.extensionFor(detected)).isEqualTo(extension);
    }

    @Test
    void anyTextOrStructuredTypeIsTextAndPublishesWithATextExtension() {
        assertThat(TextMediaTypes.isText("text/x-something")).isTrue();
        assertThat(MediaPaths.extensionFor("text/x-something")).isEqualTo("txt");
        assertThat(TextMediaTypes.isText("application/ld+json")).isTrue();
        assertThat(TextMediaTypes.isScriptLike("application/ld+json")).isTrue();
        assertThat(MediaPaths.extensionFor("application/ld+json")).isEqualTo("json");
        assertThat(TextMediaTypes.isText("application/xhtml+xml")).isTrue();
        assertThat(MediaPaths.extensionFor("application/xhtml+xml")).isEqualTo("xml");
        assertThat(MediaPaths.extensionFor("application/octet-stream")).isEqualTo("bin");
    }

    /** Known gap: Tika 2.9 doesn't know {@code .mjs}; it is still text, but published with a {@code .txt} extension. */
    @Test
    void mjsIsDetectedAsPlainText() throws IOException {
        assertThat(tika.detect(sample("sample.mjs"), "sample.mjs")).isEqualTo("text/plain");
    }

    @Test
    void binaryTypesAreNotText() {
        assertThat(TextMediaTypes.isText("image/png")).isFalse();
        assertThat(TextMediaTypes.isText("application/pdf")).isFalse();
        assertThat(TextMediaTypes.isText("application/octet-stream")).isFalse();
        assertThat(TextMediaTypes.isText(null)).isFalse();
    }

    @Test
    void parametersAndCaseAreIgnored() {
        assertThat(TextMediaTypes.isText("Text/CSS; charset=UTF-8")).isTrue();
        assertThat(TextMediaTypes.isScriptLike("application/json;charset=utf-8")).isTrue();
        assertThat(TextMediaTypes.isScriptLike("text/css")).isFalse();
    }

    @Test
    void processedNeedsFlagAndTextType() {
        ObjectMapper mapper = new ObjectMapper();
        ObjectNode css = mapper.createObjectNode().put("mimeType", "text/css");
        assertThat(TextMediaTypes.isProcessed(css)).isFalse();
        assertThat(TextMediaTypes.isProcessed(css.deepCopy().put("processCms", true))).isTrue();
        assertThat(TextMediaTypes.isProcessed(
                mapper.createObjectNode().put("mimeType", "image/png").put("processCms", true))).isFalse();
        assertThat(TextMediaTypes.isProcessed(null)).isFalse();
    }

    private static byte[] sample(String name) throws IOException {
        try (InputStream in = TextMediaTypesTest.class.getResourceAsStream("/text-media/" + name)) {
            return in.readAllBytes();
        }
    }
}
